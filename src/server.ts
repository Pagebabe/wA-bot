import Fastify from 'fastify';
import cors from '@fastify/cors';
import fastifyStatic from '@fastify/static';
import { join } from 'node:path';
import { gateway, type Conversation, type Profile, type StoredMessage } from './store.js';
import { qualifyLead, synthesizeVoice, transcribeAudio, type LlmSettings } from './ai.js';
import {
  connectWhatsApp,
  getConnection,
  restoreWhatsAppSessions,
  sendText,
  sendVoiceAudio,
  setInboundHandler,
  setVoiceTranscriber,
  unlinkWhatsApp,
} from './whatsapp.js';

const app = Fastify({ logger: true });
await app.register(cors, { origin: true, credentials: true });
await app.register(fastifyStatic, { root: join(process.cwd(), 'public'), prefix: '/' });

const port = Number(process.env.PORT || 3000);

async function settings(): Promise<any> {
  return (await gateway<{ data: any }>('get_settings')).data;
}

async function profiles(): Promise<Profile[]> {
  return (await gateway<{ data: Profile[] }>('list_profiles')).data || [];
}

async function conversations(profileId?: string): Promise<Conversation[]> {
  return (await gateway<{ data: Conversation[] }>('list_conversations', profileId ? { profile_id: profileId } : {})).data || [];
}

async function messages(conversationId: string): Promise<StoredMessage[]> {
  return (await gateway<{ data: StoredMessage[] }>('list_messages', { conversation_id: conversationId })).data || [];
}

function safeSettings(raw: any) {
  return {
    app_name: raw?.app_name || 'wA-bot',
    llm_base_url: raw?.llm_base_url || 'https://api.openai.com',
    llm_model: raw?.llm_model || 'gpt-5-mini',
    has_llm_key: Boolean(raw?.llm_api_key_encrypted),
    voice_enabled: Boolean(raw?.voice_enabled),
    voice_provider: raw?.voice_provider || 'same-api',
    voice_model: raw?.voice_model || 'gpt-4o-mini-tts',
    ai_disclosure_enabled: raw?.ai_disclosure_enabled !== false,
  };
}

async function getProfile(id: string): Promise<Profile> {
  const profile = (await profiles()).find((x) => x.id === id);
  if (!profile) throw new Error('Profil nicht gefunden');
  return profile;
}

async function addMessage(data: Record<string, unknown>) {
  return (await gateway<{ data: StoredMessage }>('add_message', { data })).data;
}

async function updateConversation(id: string, patch: Record<string, unknown>) {
  return (await gateway<{ data: Conversation }>('update_conversation', { data: { id, ...patch } })).data;
}

setVoiceTranscriber(async (audio, mime) => {
  const currentSettings = await settings();
  if (!currentSettings.voice_enabled) throw new Error('Voice transcription is disabled');
  return transcribeAudio(currentSettings as LlmSettings, audio, mime);
});

setInboundHandler(async (profileId, jid, name, text, waMessageId, raw, kind) => {
  const profile = await getProfile(profileId);
  const existing = (await conversations(profileId)).find((x) => x.wa_jid === jid);
  const now = new Date().toISOString();
  let conversation: Conversation;

  if (existing) {
    conversation = await updateConversation(existing.id, {
      contact_name: name || existing.contact_name,
      last_message_preview: kind === 'voice' ? `🎙 ${text.slice(0, 160)}` : text.slice(0, 180),
      last_message_at: now,
      unread_count: (existing.unread_count || 0) + 1,
    });
  } else {
    conversation = (await gateway<{ data: Conversation }>('upsert_conversation', {
      data: {
        profile_id: profileId,
        wa_jid: jid,
        contact_name: name,
        state: 'AI_ACTIVE',
        last_message_preview: kind === 'voice' ? `🎙 ${text.slice(0, 160)}` : text.slice(0, 180),
        last_message_at: now,
        unread_count: 1,
      },
    })).data;
  }

  await addMessage({
    conversation_id: conversation.id,
    wa_message_id: waMessageId,
    direction: 'in',
    sender: 'lead',
    kind,
    text,
    raw,
  });

  if (!profile.bot_enabled || ['HOT', 'HUMAN_ACTIVE', 'CLOSED', 'PAUSED'].includes(conversation.state)) return;

  try {
    const allMessages = await messages(conversation.id);
    const currentSettings = await settings();
    const result = await qualifyLead(currentSettings as LlmSettings, profile, conversation, allMessages);
    const turn = Number(conversation.ai_turns || 0) + 1;
    const forceHuman = turn >= Number(profile.max_ai_turns || 8);

    if (result.hot || forceHuman) {
      await updateConversation(conversation.id, {
        state: 'HOT',
        hot_score: forceHuman ? Math.max(result.score, 0.75) : result.score,
        hot_reason: forceHuman ? 'Maximale KI-Runden erreicht – manuelle Übernahme erforderlich.' : result.reason,
        ai_turns: turn,
      });
      await gateway('add_event', {
        data: { profile_id: profileId, conversation_id: conversation.id, type: 'HOT', payload: { score: result.score, reason: result.reason } },
      });
      return;
    }

    if (result.reply) {
      let reply = result.reply;
      const firstAi = !allMessages.some((m) => m.sender === 'ai');
      if (firstAi && currentSettings.ai_disclosure_enabled !== false) {
        reply = `Hinweis: Du schreibst gerade mit einem KI-Assistenten. ${reply}`;
      }
      let sentId: string | null;
      let outgoingKind: 'text' | 'voice' = 'text';
      if (profile.voice_mode === 'ai_tts' && currentSettings.voice_enabled) {
        const audio = await synthesizeVoice(currentSettings as LlmSettings, reply);
        sentId = await sendVoiceAudio(profileId, jid, audio);
        outgoingKind = 'voice';
      } else {
        sentId = await sendText(profileId, jid, reply);
      }
      await addMessage({
        conversation_id: conversation.id,
        wa_message_id: sentId,
        direction: 'out',
        sender: 'ai',
        kind: outgoingKind,
        text: reply,
      });
      await updateConversation(conversation.id, {
        ai_turns: turn,
        last_message_preview: outgoingKind === 'voice' ? `🎙 ${reply.slice(0, 160)}` : reply.slice(0, 180),
        last_message_at: new Date().toISOString(),
      });
    }
  } catch (error) {
    app.log.error(error);
    await updateConversation(conversation.id, { state: 'AI_ERROR', hot_reason: error instanceof Error ? error.message.slice(0, 300) : 'AI error' });
  }
});

app.get('/health', async () => ({ ok: true, service: 'wa-bot', version: '0.3.0' }));

app.get('/api/bootstrap', async () => {
  const [p, c, s] = await Promise.all([profiles(), conversations(), settings()]);
  return {
    profiles: p.map((profile) => ({ ...profile, connection: getConnection(profile.id) })),
    conversations: c,
    settings: safeSettings(s),
  };
});

app.get('/api/status', async () => {
  const [p, c, s] = await Promise.all([profiles(), conversations(), settings()]);
  return {
    product: 'wA-bot',
    version: '0.3.0',
    profiles: p.length,
    online: p.filter((x) => getConnection(x.id).status === 'online').length,
    hot: c.filter((x) => x.state === 'HOT').length,
    llmConfigured: Boolean(s.llm_api_key_encrypted && s.llm_model && s.llm_base_url),
    voiceEnabled: Boolean(s.voice_enabled),
  };
});

app.post('/api/settings', async (request) => {
  const body: any = request.body || {};
  const old = await settings();
  const patch: any = {
    app_name: body.app_name || old.app_name || 'wA-bot',
    llm_base_url: body.llm_base_url || old.llm_base_url || 'https://api.openai.com',
    llm_model: body.llm_model || old.llm_model || 'gpt-5-mini',
    voice_enabled: Boolean(body.voice_enabled),
    voice_provider: body.voice_provider || old.voice_provider || 'same-api',
    voice_model: body.voice_model || old.voice_model || 'gpt-4o-mini-tts',
    ai_disclosure_enabled: body.ai_disclosure_enabled !== false,
  };
  if (typeof body.llm_api_key === 'string' && body.llm_api_key.trim()) patch.llm_api_key_encrypted = body.llm_api_key.trim();
  const saved = (await gateway<{ data: any }>('save_settings', { data: patch })).data;
  return { ok: true, settings: safeSettings(saved) };
});

app.post('/api/settings/test', async (request, reply) => {
  const body: any = request.body || {};
  const s = await settings();
  const base = String(body.llm_base_url || s.llm_base_url || '').replace(/\/$/, '').replace(/\/v1$/, '') + '/v1';
  const model = body.llm_model || s.llm_model;
  const key = body.llm_api_key || s.llm_api_key_encrypted;
  if (!base || !model || !key) return reply.code(400).send({ ok: false, error: 'API-URL, Modell und Schlüssel fehlen.' });
  const r = await fetch(`${base}/chat/completions`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${key}` },
    body: JSON.stringify({ model, max_tokens: 20, messages: [{ role: 'user', content: 'Antworte nur mit OK.' }] }),
  });
  return { ok: r.ok, status: r.status, text: (await r.text()).slice(0, 300) };
});

app.post('/api/profiles', async (request, reply) => {
  const body: any = request.body || {};
  if (!String(body.name || '').trim()) return reply.code(400).send({ error: 'Name fehlt' });
  const data = {
    name: String(body.name).trim(),
    phone_label: body.phone_label || '',
    location: body.location || '',
    price_text: body.price_text || '',
    hours_text: body.hours_text || '',
    bot_enabled: body.bot_enabled !== false,
    system_prompt: body.system_prompt || undefined,
    qualification_prompt: body.qualification_prompt || undefined,
    hot_threshold: Number(body.hot_threshold ?? 0.8),
    response_style: body.response_style || 'kurz',
    max_ai_turns: Number(body.max_ai_turns ?? 8),
    handoff_behavior: body.handoff_behavior || 'stop',
    voice_mode: body.voice_mode || 'off',
    preset_name: body.preset_name || null,
  };
  Object.keys(data).forEach((k) => (data as any)[k] === undefined && delete (data as any)[k]);
  return reply.code(201).send((await gateway<{ data: Profile }>('create_profile', { data })).data);
});

app.patch('/api/profiles/:id', async (request) => {
  const id = (request.params as any).id;
  const body: any = request.body || {};
  return (await gateway<{ data: Profile }>('update_profile', { data: { id, ...body } })).data;
});

app.post('/api/profiles/:id/clone', async (request) => {
  const source = await getProfile((request.params as any).id);
  const { id: _id, status: _status, ...copy } = source as any;
  copy.name = `${source.name} Kopie`;
  copy.phone_label = '';
  return (await gateway<{ data: Profile }>('create_profile', { data: copy })).data;
});

app.delete('/api/profiles/:id', async (request) => {
  const id = (request.params as any).id;
  await unlinkWhatsApp(id).catch(() => undefined);
  await gateway('delete_profile', { id });
  return { ok: true };
});

app.post('/api/profiles/:id/connect', async (request) => {
  const profile = await getProfile((request.params as any).id);
  await connectWhatsApp(profile);
  return getConnection(profile.id);
});

app.get('/api/profiles/:id/connection', async (request) => getConnection((request.params as any).id));

app.post('/api/profiles/:id/unlink', async (request) => {
  await unlinkWhatsApp((request.params as any).id);
  return { ok: true };
});

app.get('/api/conversations/:id/messages', async (request) => ({ data: await messages((request.params as any).id) }));

app.post('/api/conversations/:id/takeover', async (request) => {
  const c = await updateConversation((request.params as any).id, { state: 'HUMAN_ACTIVE', unread_count: 0 });
  return c;
});

app.post('/api/conversations/:id/return-ai', async (request) => {
  const c = await updateConversation((request.params as any).id, { state: 'AI_ACTIVE', unread_count: 0, hot_reason: null, hot_score: null });
  return c;
});

app.post('/api/conversations/:id/close', async (request) => updateConversation((request.params as any).id, { state: 'CLOSED', unread_count: 0 }));

app.post('/api/conversations/:id/send', async (request, reply) => {
  const id = (request.params as any).id;
  const body: any = request.body || {};
  const text = String(body.text || '').trim();
  if (!text) return reply.code(400).send({ error: 'Nachricht leer' });
  const c = (await conversations()).find((x) => x.id === id);
  if (!c) return reply.code(404).send({ error: 'Chat nicht gefunden' });
  const profile = await getProfile(c.profile_id);
  const currentSettings = await settings();
  const wantsVoice = Boolean(body.voice);
  let sentId: string | null;
  let outgoingKind: 'text' | 'voice' = 'text';
  if (wantsVoice) {
    if (!currentSettings.voice_enabled || profile.voice_mode === 'off') return reply.code(400).send({ error: 'Sprachmodus ist für dieses Profil nicht aktiv.' });
    const audio = await synthesizeVoice(currentSettings as LlmSettings, text);
    sentId = await sendVoiceAudio(c.profile_id, c.wa_jid, audio);
    outgoingKind = 'voice';
  } else {
    sentId = await sendText(c.profile_id, c.wa_jid, text);
  }
  await addMessage({ conversation_id: id, wa_message_id: sentId, direction: 'out', sender: 'human', kind: outgoingKind, text });
  await updateConversation(id, { state: 'HUMAN_ACTIVE', unread_count: 0, last_message_preview: outgoingKind === 'voice' ? `🎙 ${text.slice(0, 160)}` : text.slice(0, 180), last_message_at: new Date().toISOString() });
  return { ok: true, kind: outgoingKind };
});

app.post('/api/demo/hot', async () => {
  let p = (await profiles())[0];
  if (!p) {
    p = (await gateway<{ data: Profile }>('create_profile', { data: { name: 'Demo-Profil', location: 'Köln', price_text: 'ab 80 €' } })).data;
  }
  const jid = `demo-${Date.now()}@s.whatsapp.net`;
  const c = (await gateway<{ data: Conversation }>('upsert_conversation', { data: {
    profile_id: p.id, wa_jid: jid, contact_name: 'Demo Lead', state: 'HOT', hot_score: 0.94,
    hot_reason: 'Demo: konkretes Interesse und sofort terminbereit.', unread_count: 1,
    last_message_preview: 'Ja, ich würde gern heute noch einen Termin machen.', last_message_at: new Date().toISOString(),
  } })).data;
  await addMessage({ conversation_id: c.id, direction: 'in', sender: 'lead', kind: 'text', text: 'Hallo, was kostet es und wann wäre heute noch etwas frei?' });
  await addMessage({ conversation_id: c.id, direction: 'out', sender: 'ai', kind: 'text', text: 'Heute ist grundsätzlich noch möglich. Möchtest du konkret einen Termin abstimmen?' });
  await addMessage({ conversation_id: c.id, direction: 'in', sender: 'lead', kind: 'text', text: 'Ja, ich würde gern heute noch einen Termin machen.' });
  return { ok: true, id: c.id };
});

app.setNotFoundHandler((request, reply) => {
  if (request.url.startsWith('/api/')) return reply.code(404).send({ error: 'not_found' });
  return reply.sendFile('index.html');
});

const initialProfiles = await profiles();
restoreWhatsAppSessions(initialProfiles).catch((error) => app.log.error(error));

await app.listen({ port, host: '0.0.0.0' });
