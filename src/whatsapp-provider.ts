import { timingSafeEqual } from 'node:crypto';
import type { Profile } from './store.js';
import * as baileys from './whatsapp.js';

type InboundKind = 'text' | 'voice';
type InboundHandler = (
  profileId: string,
  jid: string,
  name: string | null,
  text: string,
  waMessageId: string | null,
  raw: unknown,
  kind: InboundKind,
) => Promise<void>;
type VoiceTranscriber = (audio: Buffer, mime: string) => Promise<string>;

type ConnectionAccount = { id: string; number: string | null; name: string | null };
type ConnectionState = {
  status: 'offline' | 'connecting' | 'online' | 'error';
  qr: string | null;
  account: ConnectionAccount | null;
};

const provider = String(process.env.WHATSAPP_PROVIDER || 'baileys').trim().toLowerCase();
const evolutionBase = String(process.env.EVOLUTION_BASE_URL || process.env.EVOLUTION_API_URL || '').trim().replace(/\/$/, '');
const evolutionKey = String(process.env.EVOLUTION_API_KEY || '').trim();
const evolutionWebhookSecret = String(process.env.EVOLUTION_WEBHOOK_SECRET || '').trim();
const publicBase = String(process.env.PUBLIC_BASE_URL || process.env.RAILWAY_PUBLIC_DOMAIN || '').trim().replace(/\/$/, '');
const evolutionConnections = new Map<string, ConnectionState>();
const instanceToProfile = new Map<string, string>();
let inboundHandler: InboundHandler | null = null;
let voiceTranscriber: VoiceTranscriber | null = null;
let watchdogStarted = false;

export function whatsappProviderName() {
  return provider === 'evolution' ? 'evolution' : 'baileys';
}

function isEvolution() {
  return whatsappProviderName() === 'evolution';
}

function instanceName(profileId: string) {
  return `wab_${profileId.replace(/[^a-zA-Z0-9_-]/g, '_')}`;
}

function profileIdFromInstance(name: string) {
  return instanceToProfile.get(name) || (name.startsWith('wab_') ? name.slice(4) : null);
}

function evolutionWebhookUrl() {
  if (!publicBase) return '';
  const base = /^https?:\/\//i.test(publicBase) ? publicBase : `https://${publicBase}`;
  return `${base}/api/evolution/webhook`;
}

function requireEvolutionConfig() {
  if (!evolutionBase) throw new Error('EVOLUTION_BASE_URL fehlt');
  if (!evolutionKey) throw new Error('EVOLUTION_API_KEY fehlt');
  if (!evolutionWebhookSecret) throw new Error('EVOLUTION_WEBHOOK_SECRET fehlt');
  if (!evolutionWebhookUrl()) throw new Error('PUBLIC_BASE_URL fehlt');
}

async function evolutionRequest(path: string, init: RequestInit = {}, allow404 = false) {
  requireEvolutionConfig();
  const headers = new Headers(init.headers || {});
  headers.set('apikey', evolutionKey);
  if (init.body && !headers.has('content-type')) headers.set('content-type', 'application/json');
  const response = await fetch(`${evolutionBase}${path}`, { ...init, headers });
  const text = await response.text();
  let data: any = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = text; }
  if (allow404 && response.status === 404) return { status: response.status, data };
  if (!response.ok) {
    const detail = typeof data === 'string' ? data : JSON.stringify(data || {});
    throw new Error(`Evolution API ${response.status}: ${detail.slice(0, 400)}`);
  }
  return { status: response.status, data };
}

function normalizeNumber(jid: string) {
  const value = String(jid || '').trim();
  if (value.endsWith('@lid')) return value;
  return value.split('@')[0];
}

function accountFromEvolution(input: any): ConnectionAccount | null {
  const source = Array.isArray(input) ? input[0] : input;
  const owner = String(source?.ownerJid || source?.instance?.ownerJid || source?.owner || '').trim();
  if (!owner) return null;
  const bare = owner.split('@')[0].split(':')[0];
  const digits = bare.replace(/\D/g, '');
  const name = String(source?.profileName || source?.instance?.profileName || '').trim() || null;
  return { id: owner, number: digits ? `+${digits}` : null, name };
}

function connectionStatus(input: any): ConnectionState['status'] {
  const raw = String(
    input?.state
      || input?.status
      || input?.instance?.state
      || input?.instance?.status
      || input?.data?.state
      || input?.data?.status
      || '',
  ).toLowerCase();
  if (['open', 'connected', 'online'].includes(raw)) return 'online';
  if (['connecting', 'qr', 'pairing', 'created'].includes(raw)) return 'connecting';
  if (['close', 'closed', 'disconnected', 'offline'].includes(raw)) return 'offline';
  return raw ? 'error' : 'offline';
}

function qrDataUri(input: any): string | null {
  const candidate = input?.qrcode?.base64 || input?.qrcode?.base64Qr || input?.base64 || input?.data?.qrcode?.base64 || input?.data?.base64;
  if (typeof candidate !== 'string' || !candidate.trim()) return null;
  const value = candidate.trim();
  if (value.startsWith('data:image/')) return value;
  if (/^[A-Za-z0-9+/=\r\n]+$/.test(value) && value.length > 100) return `data:image/png;base64,${value.replace(/\s+/g, '')}`;
  return null;
}

function messageText(message: any): string | null {
  if (!message) return null;
  return message.conversation
    || message.extendedTextMessage?.text
    || message.imageMessage?.caption
    || message.videoMessage?.caption
    || message.buttonsResponseMessage?.selectedDisplayText
    || message.listResponseMessage?.title
    || null;
}

function updateEvolutionConnection(profileId: string, patch: Partial<ConnectionState>) {
  const current = evolutionConnections.get(profileId) || { status: 'offline', qr: null, account: null };
  evolutionConnections.set(profileId, { ...current, ...patch });
}

function webhookConfig() {
  return {
    enabled: true,
    url: evolutionWebhookUrl(),
    byEvents: false,
    base64: true,
    events: ['MESSAGES_UPSERT', 'CONNECTION_UPDATE', 'QRCODE_UPDATED'],
    headers: { 'x-wa-bot-secret': evolutionWebhookSecret },
  };
}

async function ensureEvolutionWebhook(name: string) {
  const expected = webhookConfig();
  const found = await evolutionRequest(`/webhook/find/${encodeURIComponent(name)}`, {}, true);
  const current = found.status === 404 ? null : found.data;
  const currentEvents = new Set(Array.isArray(current?.events) ? current.events : []);
  const headerValue = current?.headers?.['x-wa-bot-secret'];
  const good = current
    && current.enabled !== false
    && current.url === expected.url
    && expected.events.every((event) => currentEvents.has(event))
    && headerValue === evolutionWebhookSecret;
  if (!good) {
    await evolutionRequest(`/webhook/set/${encodeURIComponent(name)}`, {
      method: 'POST',
      body: JSON.stringify({ webhook: expected }),
    });
  }
}

async function refreshEvolutionConnection(profileId: string) {
  const name = instanceName(profileId);
  instanceToProfile.set(name, profileId);
  const state = await evolutionRequest(`/instance/connectionState/${encodeURIComponent(name)}`, {}, true);
  if (state.status === 404) {
    updateEvolutionConnection(profileId, { status: 'offline', qr: null, account: null });
    return;
  }
  updateEvolutionConnection(profileId, { status: connectionStatus(state.data) });
  const instance = await evolutionRequest(`/instance/fetchInstances?instanceName=${encodeURIComponent(name)}`, {}, true).catch(() => ({ status: 404, data: null }));
  const account = instance.status === 404 ? null : accountFromEvolution(instance.data);
  if (account) updateEvolutionConnection(profileId, { account });
}

function startEvolutionWebhookWatchdog() {
  if (watchdogStarted || !isEvolution()) return;
  watchdogStarted = true;
  const timer = setInterval(() => {
    for (const name of instanceToProfile.keys()) {
      void ensureEvolutionWebhook(name).catch(() => undefined);
    }
  }, 5 * 60_000);
  timer.unref?.();
}

export function setInboundHandler(handler: InboundHandler | null) {
  inboundHandler = handler;
  if (!isEvolution()) baileys.setInboundHandler(handler as any);
}

export function setVoiceTranscriber(handler: VoiceTranscriber | null) {
  voiceTranscriber = handler;
  if (!isEvolution()) baileys.setVoiceTranscriber(handler as any);
}

export async function connectWhatsApp(profile: Profile): Promise<void> {
  if (!isEvolution()) return baileys.connectWhatsApp(profile);
  requireEvolutionConfig();
  const name = instanceName(profile.id);
  instanceToProfile.set(name, profile.id);
  startEvolutionWebhookWatchdog();
  updateEvolutionConnection(profile.id, { status: 'connecting' });

  const existing = await evolutionRequest(`/instance/connectionState/${encodeURIComponent(name)}`, {}, true);
  let result: any;
  if (existing.status === 404) {
    result = (await evolutionRequest('/instance/create', {
      method: 'POST',
      body: JSON.stringify({
        instanceName: name,
        qrcode: true,
        integration: 'WHATSAPP-BAILEYS',
        rejectCall: true,
        groupsIgnore: true,
        syncFullHistory: false,
        webhook: webhookConfig(),
      }),
    })).data;
  } else {
    await ensureEvolutionWebhook(name);
    result = (await evolutionRequest(`/instance/connect/${encodeURIComponent(name)}`)).data;
  }

  updateEvolutionConnection(profile.id, {
    status: connectionStatus(result),
    qr: qrDataUri(result),
    account: accountFromEvolution(result) || evolutionConnections.get(profile.id)?.account || null,
  });
  void refreshEvolutionConnection(profile.id).catch(() => undefined);
}

export function getConnection(profileId: string) {
  if (!isEvolution()) return baileys.getConnection(profileId) as any;
  const current = evolutionConnections.get(profileId) || { status: 'offline', qr: null, account: null };
  void refreshEvolutionConnection(profileId).catch(() => undefined);
  return current;
}

function messageId(result: any) {
  return result?.key?.id || result?.message?.key?.id || result?.id || null;
}

export async function sendText(profileId: string, jid: string, text: string) {
  if (!isEvolution()) return baileys.sendText(profileId, jid, text);
  const result = (await evolutionRequest(`/message/sendText/${encodeURIComponent(instanceName(profileId))}`, {
    method: 'POST',
    body: JSON.stringify({ number: normalizeNumber(jid), text }),
  })).data;
  return messageId(result);
}

export async function sendImageUrl(profileId: string, jid: string, imageUrl: string, caption = '') {
  if (!isEvolution()) return baileys.sendImageUrl(profileId, jid, imageUrl, caption);
  const parsed = new URL(imageUrl);
  if (parsed.protocol !== 'https:') throw new Error('Only HTTPS image URLs are allowed');
  const result = (await evolutionRequest(`/message/sendMedia/${encodeURIComponent(instanceName(profileId))}`, {
    method: 'POST',
    body: JSON.stringify({ number: normalizeNumber(jid), mediatype: 'image', media: parsed.toString(), caption: caption.trim() }),
  })).data;
  return messageId(result);
}

export async function sendLocation(profileId: string, jid: string, latitude: number, longitude: number, label: string, address: string) {
  if (!isEvolution()) return baileys.sendLocation(profileId, jid, latitude, longitude, label, address);
  if (!Number.isFinite(latitude) || latitude < -90 || latitude > 90) throw new Error('Invalid latitude');
  if (!Number.isFinite(longitude) || longitude < -180 || longitude > 180) throw new Error('Invalid longitude');
  const result = (await evolutionRequest(`/message/sendLocation/${encodeURIComponent(instanceName(profileId))}`, {
    method: 'POST',
    body: JSON.stringify({ number: normalizeNumber(jid), latitude, longitude, name: label.trim() || address.trim(), address: address.trim() }),
  })).data;
  return messageId(result);
}

export async function sendVoiceAudio(profileId: string, jid: string, audio: Buffer) {
  if (!isEvolution()) return baileys.sendVoiceAudio(profileId, jid, audio);
  const result = (await evolutionRequest(`/message/sendWhatsAppAudio/${encodeURIComponent(instanceName(profileId))}`, {
    method: 'POST',
    body: JSON.stringify({ number: normalizeNumber(jid), audio: audio.toString('base64') }),
  })).data;
  return messageId(result);
}

export async function unlinkWhatsApp(profileId: string) {
  if (!isEvolution()) return baileys.unlinkWhatsApp(profileId);
  const name = instanceName(profileId);
  await evolutionRequest(`/instance/logout/${encodeURIComponent(name)}`, { method: 'DELETE' }, true);
  evolutionConnections.delete(profileId);
  instanceToProfile.delete(name);
}

export async function restoreWhatsAppSessions(profiles: Profile[]) {
  if (!isEvolution()) return baileys.restoreWhatsAppSessions(profiles);
  requireEvolutionConfig();
  startEvolutionWebhookWatchdog();
  await Promise.all(profiles.map(async (profile) => {
    const name = instanceName(profile.id);
    instanceToProfile.set(name, profile.id);
    await refreshEvolutionConnection(profile.id).catch(() => undefined);
    await ensureEvolutionWebhook(name).catch(() => undefined);
  }));
}

export function isEvolutionWebhookAuthorized(value: string | string[] | undefined) {
  if (!isEvolution() || !evolutionWebhookSecret || Array.isArray(value)) return false;
  const provided = Buffer.from(String(value || ''));
  const expected = Buffer.from(evolutionWebhookSecret);
  return provided.length === expected.length && timingSafeEqual(provided, expected);
}

export async function handleEvolutionWebhook(payload: any) {
  if (!isEvolution()) return;
  const event = String(payload?.event || '').toLowerCase();
  const name = String(payload?.instance || payload?.instanceName || '').trim();
  const profileId = name ? profileIdFromInstance(name) : null;
  if (!profileId) return;

  if (event === 'connection.update') {
    const status = connectionStatus(payload?.data || payload);
    const account = accountFromEvolution(payload?.data || payload);
    updateEvolutionConnection(profileId, { status, qr: status === 'online' ? null : evolutionConnections.get(profileId)?.qr || null, ...(account ? { account } : {}) });
    if (status === 'online') void ensureEvolutionWebhook(name).catch(() => undefined);
    return;
  }

  if (event === 'qrcode.updated') {
    updateEvolutionConnection(profileId, { status: 'connecting', qr: qrDataUri(payload?.data || payload) });
    return;
  }

  if (event !== 'messages.upsert' || !inboundHandler) return;
  const data = payload?.data || {};
  const key = data?.key || {};
  if (!key?.remoteJid || key.fromMe) return;
  const jid = String(key.remoteJid);
  if (jid === 'status@broadcast' || jid.endsWith('@g.us')) return;

  let text = messageText(data.message);
  let kind: InboundKind = 'text';
  if (!text && data?.message?.audioMessage && voiceTranscriber) {
    const rawBase64 = data?.base64 || data?.message?.base64 || payload?.base64;
    if (typeof rawBase64 === 'string' && rawBase64.trim()) {
      try {
        const clean = rawBase64.includes(',') ? rawBase64.slice(rawBase64.indexOf(',') + 1) : rawBase64;
        text = await voiceTranscriber(Buffer.from(clean, 'base64'), data.message.audioMessage.mimetype || 'audio/ogg');
        kind = 'voice';
      } catch {
        text = null;
      }
    }
  }
  if (!text) return;
  await inboundHandler(profileId, jid, data.pushName || null, String(text), key.id || null, payload, kind);
}
