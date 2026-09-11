import makeWASocket, {
  BufferJSON,
  DisconnectReason,
  initAuthCreds,
  makeCacheableSignalKeyStore,
  proto,
} from '@whiskeysockets/baileys';
import { Boom } from '@hapi/boom';
import P from 'pino';
import QRCode from 'qrcode';
import { gateway, type Profile } from './store.js';

const logger = P({ level: process.env.NODE_ENV === 'production' ? 'warn' : 'info' });

type Session = {
  socket: any;
  qrDataUrl: string | null;
  status: 'offline' | 'connecting' | 'online' | 'error';
  reconnecting: boolean;
};

const sessions = new Map<string, Session>();
let inboundHandler: ((profileId: string, jid: string, name: string | null, text: string, waMessageId: string | null, raw: unknown) => Promise<void>) | null = null;

export function setInboundHandler(handler: typeof inboundHandler) {
  inboundHandler = handler;
}

async function authRead(profileId: string, keys: string[]): Promise<Map<string, string>> {
  if (!keys.length) return new Map();
  const res = await gateway<{ data: Array<{ key: string; value: string }> }>('auth_get', { profile_id: profileId, keys });
  return new Map((res.data || []).map((x) => [x.key, x.value]));
}

async function authWrite(profileId: string, items: Array<{ key: string; value: string | null }>) {
  await gateway('auth_set', { profile_id: profileId, items });
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
  if (!message) return null;
  return message.conversation
    || message.extendedTextMessage?.text
    || message.imageMessage?.caption
    || message.videoMessage?.caption
    || message.buttonsResponseMessage?.selectedDisplayText
    || message.listResponseMessage?.title
    || null;
}

export async function connectWhatsApp(profile: Profile): Promise<void> {
  const existing = sessions.get(profile.id);
  if (existing?.status === 'online' || existing?.status === 'connecting') return;

  const { state, saveCreds } = await buildAuthState(profile.id);
  const session: Session = { socket: null, qrDataUrl: null, status: 'connecting', reconnecting: false };
  sessions.set(profile.id, session);
  await setProfileStatus(profile.id, 'connecting');

  const socket = makeWASocket({
    auth: state as any,
    logger: logger as any,
    markOnlineOnConnect: false,
    syncFullHistory: false,
    generateHighQualityLinkPreview: false,
  });
  session.socket = socket;

  socket.ev.on('creds.update', saveCreds);
  socket.ev.on('connection.update', async (update: any) => {
    if (update.qr) {
      session.qrDataUrl = await QRCode.toDataURL(update.qr, { margin: 1, width: 320 });
      session.status = 'connecting';
      await setProfileStatus(profile.id, 'connecting');
    }
    if (update.connection === 'open') {
      session.qrDataUrl = null;
      session.status = 'online';
      session.reconnecting = false;
      await setProfileStatus(profile.id, 'online');
    }
    if (update.connection === 'close') {
      const code = (update.lastDisconnect?.error as Boom | undefined)?.output?.statusCode;
      const loggedOut = code === DisconnectReason.loggedOut;
      session.status = loggedOut ? 'offline' : 'error';
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
        }, 2500);
      }
    }
  });

  socket.ev.on('messages.upsert', async ({ messages, type }: any) => {
    if (type !== 'notify') return;
    for (const msg of messages || []) {
      if (!msg?.key?.remoteJid || msg.key.fromMe) continue;
      const jid = String(msg.key.remoteJid);
      if (jid === 'status@broadcast' || jid.endsWith('@g.us')) continue;
      const text = extractText(msg.message);
      if (!text || !inboundHandler) continue;
      await inboundHandler(profile.id, jid, msg.pushName || null, text, msg.key.id || null, msg).catch((error) => logger.error(error));
    }
  });
}

export function getConnection(profileId: string) {
  const session = sessions.get(profileId);
  return session ? { status: session.status, qr: session.qrDataUrl } : { status: 'offline', qr: null };
}

export async function sendText(profileId: string, jid: string, text: string) {
  const session = sessions.get(profileId);
  if (!session?.socket || session.status !== 'online') throw new Error('WhatsApp profile is not online');
  const sent = await session.socket.sendMessage(jid, { text });
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
