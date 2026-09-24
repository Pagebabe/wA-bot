import makeWASocket, {
  BufferJSON,
  DisconnectReason,
  downloadMediaMessage,
  initAuthCreds,
  makeCacheableSignalKeyStore,
  proto,
} from '@whiskeysockets/baileys';
import { Boom } from '@hapi/boom';
import P from 'pino';
import QRCode from 'qrcode';
import { gateway, type Profile } from './store.js';
import { inboundAudio, inboundText } from './whatsapp-message.js';

const logger = P({ level: process.env.NODE_ENV === 'production' ? 'warn' : 'info' });

type Session = {
  socket: any;
  qrDataUrl: string | null;
  status: 'offline' | 'connecting' | 'online' | 'error';
  account: { id: string; number: string | null; name: string | null } | null;
  reconnecting: boolean;
  connectWatch?: ReturnType<typeof setTimeout>;
};

type InboundKind = 'text' | 'voice';
type HistoryHandler = (
  profileId: string,
  jid: string,
  name: string | null,
  text: string,
  waMessageId: string | null,
  raw: unknown,
  kind: InboundKind,
  fromMe: boolean,
  createdAt: string | null,
) => Promise<void>;

const sessions = new Map<string, Session>();
const configuredConnectTimeoutMs = Number(process.env.WA_CONNECT_TIMEOUT_MS || 45_000);
const connectTimeoutMs = Number.isFinite(configuredConnectTimeoutMs)
  ? Math.max(10_000, configuredConnectTimeoutMs)
  : 45_000;
let inboundHandler: ((profileId: string, jid: string, name: string | null, text: string, waMessageId: string | null, raw: unknown, kind: InboundKind) => Promise<void>) | null = null;
let historyHandler: HistoryHandler | null = null;
let voiceTranscriber: ((audio: Buffer, mime: string) => Promise<string>) | null = null;

function clearConnectWatch(session: Session) {
  if (!session.connectWatch) return;
  clearTimeout(session.connectWatch);
  session.connectWatch = undefined;
}

function accountFromUser(user: any) {
  const id = typeof user?.id === 'string' ? user.id.trim() : '';
  if (!id) return null;
  const bare = id.split('@')[0].split(':')[0];
  const digits = bare.replace(/\D/g, '');
  const name = typeof user?.name === 'string' && user.name.trim() ? user.name.trim() : null;
  return { id, number: digits ? `+${digits}` : null, name };
}

export function setInboundHandler(handler: typeof inboundHandler) {
  inboundHandler = handler;
}

export function setVoiceTranscriber(handler: typeof voiceTranscriber) {
  voiceTranscriber = handler;
}

export function setHistoryHandler(handler: HistoryHandler | null) {
  historyHandler = handler;
}

async function authRead(profileId: string, keys: string[]): Promise<Map<string, string>> {
  if (!keys.length) return new Map();
  const res = await gateway<{ data: Array<{ key: string; value: string }> }>('auth_get', { profile_id: profileId, keys });
  return new Map((res.data || []).map((x) => [x.key, x.value]));
}

const authWriteQueues = new Map<string, Promise<void>>();

async function authWrite(profileId: string, items: Array<{ key: string; value: string | null }>) {
  const previous = authWriteQueues.get(profileId) || Promise.resolve();
  const current = previous.catch(() => undefined).then(async () => {
    await gateway('auth_set', { profile_id: profileId, items });
  });
  authWriteQueues.set(profileId, current);
  try {
    await current;
  } finally {
    if (authWriteQueues.get(profileId) === current) authWriteQueues.delete(profileId);
  }
}

async function buildAuthState(profileId: string) {
  const credsRow = await authRead(profileId, ['creds.json']);
  const creds = credsRow.has('creds.json')
    ? JSON.parse(credsRow.get('creds.json')!, BufferJSON.reviver)
    : initAuthCreds();

  const keys = {
    get: async (type: string, ids: string[]) => {
      const names = ids.map((id) => `${type}-${id}`);
      const rows = await authRead(profileId, names);
      const result: Record<string, any> = {};
      for (const id of ids) {
        const raw = rows.get(`${type}-${id}`);
        let value = raw ? JSON.parse(raw, BufferJSON.reviver) : null;
        if (type === 'app-state-sync-key' && value) value = proto.Message.AppStateSyncKeyData.fromObject(value);
        result[id] = value;
      }
      return result;
    },
    set: async (data: Record<string, Record<string, any>>) => {
      const items: Array<{ key: string; value: string | null }> = [];
      for (const [category, values] of Object.entries(data)) {
        for (const [id, value] of Object.entries(values || {})) {
          items.push({
            key: `${category}-${id}`,
            value: value == null ? null : JSON.stringify(value, BufferJSON.replacer),
          });
        }
      }
      if (items.length) await authWrite(profileId, items);
    },
  };

  return {
    state: { creds, keys: makeCacheableSignalKeyStore(keys as any, logger) },
    saveCreds: () => authWrite(profileId, [{ key: 'creds.json', value: JSON.stringify(creds, BufferJSON.replacer) }]),
  };
}

async function setProfileStatus(profileId: string, status: Session['status']) {
  await gateway('update_profile', { data: { id: profileId, status } }).catch(() => undefined);
}

function extractText(message: any): string | null {
  return inboundText(message);
}

export async function connectWhatsApp(profile: Profile): Promise<void> {
  const existing = sessions.get(profile.id);
  if (existing?.status === 'online' || existing?.status === 'connecting') return;

  const { state, saveCreds } = await buildAuthState(profile.id);
  const session: Session = { socket: null, qrDataUrl: null, status: 'connecting', account: accountFromUser(state.creds?.me), reconnecting: false };
  sessions.set(profile.id, session);
  await setProfileStatus(profile.id, 'connecting');

  const historyExportProfileId = String(process.env.WHATSAPP_HISTORY_EXPORT_PROFILE_ID || '').trim();
  const syncFullHistory = process.env.WHATSAPP_SYNC_FULL_HISTORY === 'true'
    || historyExportProfileId === profile.id;

  const socket = makeWASocket({
    auth: state as any,
    logger: logger as any,
    markOnlineOnConnect: false,
    syncFullHistory,
    generateHighQualityLinkPreview: false,
  });
  session.socket = socket;
  session.connectWatch = setTimeout(() => {
    if (sessions.get(profile.id) !== session || session.status !== 'connecting' || session.qrDataUrl) return;
    session.reconnecting = true;
    clearConnectWatch(session);
    try {
      session.socket?.end(new Error('WhatsApp connect watchdog timeout'));
    } catch (error) {
      logger.warn(error);
    }
    sessions.delete(profile.id);
    setTimeout(() => {
      connectWhatsApp(profile).catch(async (error) => {
        logger.error(error);
        await setProfileStatus(profile.id, 'error');
      });
    }, 250);
  }, connectTimeoutMs);

  socket.ev.on('creds.update', saveCreds);
  socket.ev.on('connection.update', async (update: any) => {
    if (update.qr) {
      clearConnectWatch(session);
      session.qrDataUrl = await QRCode.toDataURL(update.qr, { margin: 1, width: 320 });
      session.status = 'connecting';
      await setProfileStatus(profile.id, 'connecting');
    }
    if (update.connection === 'open') {
      clearConnectWatch(session);
      session.qrDataUrl = null;
      session.status = 'online';
      session.account = accountFromUser(socket.user) || accountFromUser(state.creds?.me) || session.account;
      session.reconnecting = false;
      await setProfileStatus(profile.id, 'online');
    }
    if (update.connection === 'close') {
      clearConnectWatch(session);
      const code = (update.lastDisconnect?.error as Boom | undefined)?.output?.statusCode;
      const loggedOut = code === DisconnectReason.loggedOut;
      const restartRequired = code === DisconnectReason.restartRequired;
      logger.warn({
        profileId: profile.id,
        code,
        restartRequired,
        loggedOut,
        message: update.lastDisconnect?.error instanceof Error ? update.lastDisconnect.error.message : String(update.lastDisconnect?.error || ''),
      }, 'WhatsApp connection closed');
      session.status = loggedOut ? 'offline' : restartRequired ? 'connecting' : 'error';
      await setProfileStatus(profile.id, session.status);
      if (loggedOut) {
        await gateway('auth_clear', { profile_id: profile.id }).catch(() => undefined);
        sessions.delete(profile.id);
        return;
      }
      if (!session.reconnecting) {
        session.reconnecting = true;
        setTimeout(() => {
          sessions.delete(profile.id);
          connectWhatsApp(profile).catch(async () => setProfileStatus(profile.id, 'error'));
        }, restartRequired ? 250 : 2500);
      }
    }
  });

  socket.ev.on('messaging-history.set', async ({ messages, contacts, syncType, progress, isLatest }: any) => {
    logger.warn({
      profileId: profile.id,
      messageCount: Array.isArray(messages) ? messages.length : 0,
      contactCount: Array.isArray(contacts) ? contacts.length : 0,
      syncType: syncType ?? null,
      progress: progress ?? null,
      isLatest: isLatest ?? null,
    }, 'WhatsApp history chunk received');
    if (!historyHandler) return;
    const contactNames = new Map<string, string>();
    for (const contact of contacts || []) {
      const jid = String(contact?.id || '').trim();
      const name = String(contact?.name || contact?.notify || contact?.verifiedName || '').trim();
      if (jid && name) contactNames.set(jid, name);
    }
    for (const msg of messages || []) {
      const jid = String(msg?.key?.remoteJid || '');
      if (!jid || jid === 'status@broadcast' || jid.endsWith('@g.us')) continue;
      const text = extractText(msg.message);
      if (!text) continue;
      const timestampRaw = Number(msg?.messageTimestamp || 0);
      const createdAt = Number.isFinite(timestampRaw) && timestampRaw > 0
        ? new Date(timestampRaw * 1000).toISOString()
        : null;
      await historyHandler(
        profile.id,
        jid,
        contactNames.get(jid) || msg.pushName || null,
        text,
        msg.key.id || null,
        msg,
        'text',
        Boolean(msg.key.fromMe),
        createdAt,
      ).catch((error) => logger.error(error));
    }
  });

  socket.ev.on('messages.upsert', async ({ messages, type }: any) => {
    if (type !== 'notify') return;
    for (const msg of messages || []) {
      if (!msg?.key?.remoteJid || msg.key.fromMe) continue;
      const jid = String(msg.key.remoteJid);
      if (jid === 'status@broadcast' || jid.endsWith('@g.us')) continue;
      let text = extractText(msg.message);
      let kind: InboundKind = 'text';
      const audioMessage = inboundAudio(msg.message);
      if (!text && audioMessage && voiceTranscriber) {
        try {
          const media = await (downloadMediaMessage as any)(msg, 'buffer', {}, { logger, reuploadRequest: socket.updateMediaMessage });
          const buffer = Buffer.isBuffer(media) ? media : Buffer.from(media);
          text = await voiceTranscriber(buffer, audioMessage.mimetype || 'audio/ogg');
          kind = 'voice';
        } catch (error) {
          logger.error(error);
        }
      }
      if (!text || !inboundHandler) continue;
      await inboundHandler(profile.id, jid, msg.pushName || null, text, msg.key.id || null, msg, kind).catch((error) => logger.error(error));
    }
  });
}

export function getConnection(profileId: string) {
  const session = sessions.get(profileId);
  return session ? { status: session.status, qr: session.qrDataUrl, account: session.account } : { status: 'offline', qr: null, account: null };
}

export async function sendText(profileId: string, jid: string, text: string) {
  const session = sessions.get(profileId);
  if (!session?.socket || session.status !== 'online') throw new Error('WhatsApp profile is not online');
  const sent = await session.socket.sendMessage(jid, { text });
  return sent?.key?.id || null;
}

export async function sendImageUrl(profileId: string, jid: string, imageUrl: string, caption = '') {
  const session = sessions.get(profileId);
  if (!session?.socket || session.status !== 'online') throw new Error('WhatsApp profile is not online');
  const parsed = new URL(imageUrl);
  if (parsed.protocol !== 'https:') throw new Error('Only HTTPS image URLs are allowed');
  const sent = await session.socket.sendMessage(jid, { image: { url: parsed.toString() }, ...(caption.trim() ? { caption: caption.trim() } : {}) });
  return sent?.key?.id || null;
}

export async function sendLocation(profileId: string, jid: string, latitude: number, longitude: number, label: string, address: string) {
  const session = sessions.get(profileId);
  if (!session?.socket || session.status !== 'online') throw new Error('WhatsApp profile is not online');
  if (!Number.isFinite(latitude) || latitude < -90 || latitude > 90) throw new Error('Invalid latitude');
  if (!Number.isFinite(longitude) || longitude < -180 || longitude > 180) throw new Error('Invalid longitude');
  const sent = await session.socket.sendMessage(jid, { location: { degreesLatitude: latitude, degreesLongitude: longitude, name: label.trim() || address.trim(), address: address.trim() } });
  return sent?.key?.id || null;
}

export async function sendVoiceAudio(profileId: string, jid: string, audio: Buffer, mime = 'audio/mpeg') {
  const session = sessions.get(profileId);
  if (!session?.socket || session.status !== 'online') throw new Error('WhatsApp profile is not online');
  const sent = await session.socket.sendMessage(jid, { audio, mimetype: mime, ptt: true });
  return sent?.key?.id || null;
}

export async function unlinkWhatsApp(profileId: string) {
  const session = sessions.get(profileId);
  try { if (session?.socket) await session.socket.logout(); } catch {}
  sessions.delete(profileId);
  await gateway('auth_clear', { profile_id: profileId });
  await setProfileStatus(profileId, 'offline');
}

export async function restoreWhatsAppSessions(profiles: Profile[]) {
  for (const profile of profiles) {
    const auth = await gateway<{ data: Array<{ key: string; value: string }> }>('auth_list', { profile_id: profile.id }).catch(() => ({ data: [] }));
    if (auth.data?.some((x) => x.key === 'creds.json')) {
      connectWhatsApp(profile).catch(async () => setProfileStatus(profile.id, 'error'));
    } else if (profile.status !== 'offline') {
      await setProfileStatus(profile.id, 'offline');
    }
  }
}
