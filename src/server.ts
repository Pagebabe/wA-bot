import Fastify from 'fastify';
import cors from '@fastify/cors';
import fastifyStatic from '@fastify/static';
import { join } from 'node:path';
import { gateway, type Conversation, type Profile, type StoredMessage } from './store.js';
import { qualifyLead, synthesizeVoice, transcribeAudio, type LlmSettings } from './ai.js';
import { CHAT_POLICY_VERSION, GLOBAL_HOT_THRESHOLD, GLOBAL_MAX_AI_TURNS, SAVED_REPLIES } from './chat-policy.js';
import { autocompletePlaces, getPlaceDetails } from './places.js';
import { verifyBasicAuthorization } from './auth.js';
import { getVapidPublicKey, notifyHotLead, savePushSubscription } from './push.js';
import { persistInboundMessage } from './inbound-message.js';
import { buildTrainingConversation, toJsonl, waLinkFromJid } from './training-export.js';
import { runTrainingSimulation } from './training-simulation.js';
import { clearPendingReviewPatch, isHumanGateEnabled, pendingReviewPatch, reviewMatches } from './human-gate.js';
import {
  connectWhatsApp,
  getConnection,
  restoreWhatsAppSessions,
  sendText,
  sendImageUrl,
  sendLocation,
  sendVoiceAudio,
  setInboundHandler,
  setHistoryHandler,
  setVoiceTranscriber,
  unlinkWhatsApp,
  handleEvolutionWebhook,
  isEvolutionWebhookAuthorized,
  whatsappProviderName,
} from './whatsapp-provider.js';

const app = Fastify({ logger: true });
await app.register(cors, { origin: false });

const port = Number(process.env.PORT || 3000);
let adminAuthCache: { salt: string; hash: string; iterations: number; expiresAt: number } | null = null;

async function settings(): Promise<any> {
  const stored = (await gateway<{ data: any }>('get_settings')).data || {};
  return {
    ...stored,
    llm_base_url: stored.llm_base_url || process.env.LLM_BASE_URL,
    llm_model: stored.llm_model || process.env.LLM_MODEL,
    llm_api_key_encrypted: process.env.LLM_API_KEY || stored.llm_api_key_encrypted,
    tts_api_key: process.env.ELEVENLABS_API_KEY || stored.tts_api_key,
    tts_voice_id: process.env.ELEVENLABS_VOICE_ID || stored.tts_voice_id,
    tts_model: process.env.ELEVENLABS_MODEL_ID || stored.tts_model,
    stt_api_key: process.env.OPENAI_API_KEY || stored.stt_api_key,
    stt_base_url: process.env.STT_BASE_URL || stored.stt_base_url || 'https://api.openai.com',
    stt_model: process.env.STT_MODEL || stored.stt_model,
  };
}

async function getAdminAuthSettings() {
  if (adminAuthCache && adminAuthCache.expiresAt > Date.now()) {
    return {
      admin_password_salt: adminAuthCache.salt,
      admin_password_hash: adminAuthCache.hash,
      admin_password_iterations: adminAuthCache.iterations,
    };
  }
  const current = await settings();
  adminAuthCache = {
    salt: String(current.admin_password_salt || ''),
    hash: String(current.admin_password_hash || ''),
    iterations: Number(current.admin_password_iterations || 210000),
    expiresAt: Date.now() + 60_000,
  };
  return current;
}

app.addHook('onRequest', async (request, reply) => {
  if (request.url === '/health' || request.url === '/api/evolution/webhook') return;
  if (request.url.startsWith('/api/pairing/')) {
    const expected = String(process.env.PAIRING_TOKEN || '');
    const supplied = String((request.query as any)?.token || '');
    if (expected && supplied === expected) return;
  }
  const authSettings = await getAdminAuthSettings();
  if (!verifyBasicAuthorization(request.headers.authorization, authSettings)) {
    reply.header('WWW-Authenticate', 'Basic realm="wA-bot", charset="UTF-8"');
    return reply.code(401).type('text/plain').send('Anmeldung erforderlich');
  }
});

await app.register(fastifyStatic, { root: join(process.cwd(), 'public'), prefix: '/' });

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
    llm_base_url: raw?.llm_base_url || 'https://generativelanguage.googleapis.com/v1beta/openai/',
    llm_model: raw?.llm_model || 'gemini-3.5-flash-lite',
    has_llm_key: Boolean(raw?.llm_api_key_encrypted),
    llm_key_source: process.env.LLM_API_KEY ? 'environment' : 'database',
    voice_enabled: Boolean(raw?.voice_enabled),
    voice_provider: raw?.voice_provider || 'same-api',
    voice_model: raw?.voice_model || 'gpt-4o-mini-tts',
    has_tts_key: Boolean(raw?.tts_api_key && raw?.tts_voice_id),
    has_stt_key: Boolean(raw?.stt_api_key),
    chat_policy_version: CHAT_POLICY_VERSION,
    ai_disclosure_enabled: raw?.ai_disclosure_enabled !== false,
    human_gate_enabled: isHumanGateEnabled(),
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

setHistoryHandler(async (profileId, jid, name, text, waMessageId, raw, kind, fromMe, createdAt) => {
  const profile = await getProfile(profileId);
  const existing = (await conversations(profileId)).find((x) => x.wa_jid === jid);
  const timestamp = createdAt || new Date().toISOString();
  const conversation = existing || (await gateway<{ data: Conversation }>('upsert_conversation', {
    data: {
      profile_id: profile.id,
      wa_jid: jid,
      contact_name: name,
      state: 'CLOSED',
      ai_turns: 0,
      unread_count: 0,
      last_message_preview: text.slice(0, 180),
      last_message_at: timestamp,
    },
  })).data;

  if (waMessageId) {
    const duplicate = (await messages(conversation.id)).some((message) => message.wa_message_id === waMessageId);
    if (duplicate) {
      app.log.info({ profileId, conversationId: conversation.id, waMessageId }, 'Duplicate WhatsApp history message ignored');
      return;
    }
  }

  await addMessage({
    conversation_id: conversation.id,
    wa_message_id: waMessageId,
    direction: fromMe ? 'out' : 'in',
    sender: fromMe ? 'human' : 'lead',
    kind,
    text,
    raw,
    created_at: timestamp,
  });

  if (!existing || !existing.last_message_at || timestamp > existing.last_message_at) {
    await updateConversation(conversation.id, {
      contact_name: name || conversation.contact_name || null,
      last_message_preview: text.slice(0, 180),
      last_message_at: timestamp,
    });
  }
});

setInboundHandler(async (profileId, jid, name, text, waMessageId, raw, kind) => {
  const profile = await getProfile(profileId);
  const humanGate = isHumanGateEnabled();
  const existing = (await conversations(profileId)).find((x) => x.wa_jid === jid);
  if (existing && waMessageId) {
    const duplicate = (await messages(existing.id)).some((m) => m.wa_message_id === waMessageId);
    if (duplicate) {
      app.log.info({ profileId, conversationId: existing.id, waMessageId }, 'Duplicate WhatsApp message ignored');
      return;
    }
  }
  const now = new Date().toISOString();
  let conversation = await persistInboundMessage({
    findConversation: async () => existing || null,
    updateConversation: async (id, patch) => updateConversation(id, patch),
    upsertConversation: async (data) => (await gateway<{ data: Conversation }>('upsert_conversation', { data })).data,
    addMessage: async (data) => addMessage(data),
  }, {
    profileId,
    jid,
    name,
    text,
    waMessageId,
    raw,
    kind,
    botEnabled: profile.bot_enabled,
    now,
  }) as Conversation;

  if (!profile.bot_enabled || ['HOT', 'HUMAN_ACTIVE', 'CLOSED'].includes(conversation.state)) return;
  if (conversation.state === 'PAUSED' && !humanGate) return;

  try {
    const allMessages = await messages(conversation.id);
    const currentSettings = await settings();
    const result = await qualifyLead(currentSettings as LlmSettings, profile, conversation, allMessages);
    const latestConversation = (await conversations(profileId)).find((x) => x.id === conversation.id);
    if (
      !latestConversation
      || (latestConversation.state !== 'AI_ACTIVE' && !(humanGate && latestConversation.state === 'PAUSED'))
    ) {
      app.log.info({ profileId, conversationId: conversation.id, state: latestConversation?.state }, 'AI result discarded after ownership/state changed');
      return;
    }
    conversation = latestConversation;
    const turn = Number(conversation.ai_turns || 0) + 1;
    const forceHuman = !humanGate && turn >= GLOBAL_MAX_AI_TURNS;
    const hotReason = forceHuman ? 'Maximale KI-Runden erreicht – manuelle Übernahme erforderlich.' : result.reason;

    let outgoingText = result.reply;
    const firstAi = !allMessages.some((m) => m.sender === 'ai');
    if (outgoingText && firstAi && currentSettings.ai_disclosure_enabled !== false) {
      outgoingText = `Hinweis: Du schreibst gerade mit einem KI-Assistenten. ${outgoingText}`;
    }

    if (humanGate) {
      const reviewCreatedAt = new Date().toISOString();
      const candidate = {
        reply: outgoingText || '',
        hot: Boolean(result.hot),
        score: result.score,
        reason: result.reason || '',
      };
      await updateConversation(conversation.id, {
        ...pendingReviewPatch(candidate, reviewCreatedAt),
        hot_score: candidate.score,
        hot_reason: candidate.reason,
      });
      await gateway('add_event', {
        data: {
          profile_id: profileId,
          conversation_id: conversation.id,
          type: 'AI_REVIEW_REQUIRED',
          payload: {
            hot: candidate.hot,
            score: candidate.score,
            reason: candidate.reason,
            has_reply: Boolean(candidate.reply),
          },
        },
      });
      return;
    }

    if (result.hot || forceHuman) {
      await updateConversation(conversation.id, {
        state: 'HOT',
        hot_score: forceHuman ? Math.max(result.score, 0.75) : result.score,
        hot_reason: hotReason,
        ai_turns: turn,
      });
      await gateway('add_event', {
        data: { profile_id: profileId, conversation_id: conversation.id, type: 'HOT', payload: { score: result.score, reason: hotReason } },
      });
      void notifyHotLead({
        conversationId: conversation.id,
        contactName: name || conversation.contact_name || 'Neuer Lead',
        profileName: profile.name,
        preview: text,
      }).catch((error) => app.log.warn({ err: error }, 'Push notification failed'));
      return;
    }

    if (outgoingText) {
      let sentId: string | null = null;
      let outgoingKind: 'text' | 'voice' = 'text';
      if (kind === 'voice' && currentSettings.voice_enabled) {
        try {
          const audio = await synthesizeVoice(currentSettings as LlmSettings, outgoingText, 'alloy');
          sentId = await sendVoiceAudio(profileId, jid, audio.buffer, audio.mime);
          outgoingKind = 'voice';
        } catch (voiceError) {
          app.log.warn({ err: voiceError }, 'AI voice reply failed, falling back to text');
          sentId = await sendText(profileId, jid, outgoingText);
        }
      } else {
        sentId = await sendText(profileId, jid, outgoingText);
      }
      await addMessage({
        conversation_id: conversation.id,
        wa_message_id: sentId,
        direction: 'out',
        sender: 'ai',
        kind: outgoingKind,
        text: outgoingText,
      });
      await updateConversation(conversation.id, {
        ai_turns: turn,
        last_message_preview: outgoingKind === 'voice' ? `🎙 ${outgoingText.slice(0, 160)}` : outgoingText.slice(0, 180),
        last_message_at: new Date().toISOString(),
      });
    }
  } catch (error) {
    app.log.error(error);
    await updateConversation(conversation.id, { state: 'AI_ERROR', hot_reason: error instanceof Error ? error.message.slice(0, 300) : 'AI error' });
  }
});

app.post('/api/evolution/webhook', async (request, reply) => {
  const secret = request.headers['x-wa-bot-secret'];
  if (!isEvolutionWebhookAuthorized(secret)) return reply.code(401).send({ error: 'Ungültiger Webhook-Schlüssel' });
  await handleEvolutionWebhook(request.body);
  return { ok: true };
});

app.get('/health', async () => ({ ok: true, service: 'wa-bot', version: '0.4.0', release: '2026-09-24-go-live', whatsappProvider: whatsappProviderName() }));

app.get('/api/bootstrap', async () => {
  const [p, c, s] = await Promise.all([profiles(), conversations(), settings()]);
  return {
    profiles: p.map((profile) => ({ ...profile, connection: getConnection(profile.id) })),
    conversations: c,
    settings: safeSettings(s),
    savedReplies: SAVED_REPLIES,
  };
});

app.get('/api/places/autocomplete', async (request, reply) => {
  try {
    return { suggestions: await autocompletePlaces(String((request.query as any)?.q || '')) };
  } catch (error) {
    return reply.code(503).send({ error: error instanceof Error ? error.message : 'Adresssuche fehlgeschlagen' });
  }
});

app.get('/api/places/details', async (request, reply) => {
  try {
    return { location: await getPlaceDetails(String((request.query as any)?.placeId || '')) };
  } catch (error) {
    return reply.code(503).send({ error: error instanceof Error ? error.message : 'Adressauflösung fehlgeschlagen' });
  }
});

app.get('/api/status', async () => {
  const [p, c, s] = await Promise.all([profiles(), conversations(), settings()]);
  return {
    product: 'wA-bot',
    version: '0.4.0',
    profiles: p.length,
    online: p.filter((x) => getConnection(x.id).status === 'online').length,
    hot: c.filter((x) => x.state === 'HOT').length,
    llmConfigured: Boolean(s.llm_api_key_encrypted && s.llm_model && s.llm_base_url),
    voiceEnabled: Boolean(s.voice_enabled),
  };
});

app.get('/api/push/key', async () => ({ publicKey: await getVapidPublicKey() }));

app.post('/api/push/subscribe', async (request, reply) => {
  const body: any = request.body || {};
  const subscription = body.subscription;
  if (!subscription?.endpoint || !subscription?.keys?.p256dh || !subscription?.keys?.auth) {
    return reply.code(400).send({ error: 'Ungültiges Push-Abonnement' });
  }
  await savePushSubscription({
    endpoint: String(subscription.endpoint),
    keys: { p256dh: String(subscription.keys.p256dh), auth: String(subscription.keys.auth) },
    userAgent: String(request.headers['user-agent'] || ''),
  });
  return { ok: true };
});

app.post('/api/settings', async (request) => {
  const body: any = request.body || {};
  const old = await settings();
  const patch: any = {
    app_name: body.app_name || old.app_name || 'wA-bot',
    llm_base_url: body.llm_base_url || old.llm_base_url || 'https://generativelanguage.googleapis.com/v1beta/openai/',
    llm_model: body.llm_model || old.llm_model || 'gemini-3.5-flash-lite',
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
    desired_location: body.desired_location || '',
    share_location: body.share_location || null,
    entry_photos: body.entry_photos || {},
    price_text: body.price_text || '',
    hours_text: body.hours_text || '',
    avatar_url: body.avatar_url || null,
    quick_replies: [],
    bot_enabled: body.bot_enabled !== false,
    system_prompt: 'central-policy',
    qualification_prompt: 'central-policy',
    hot_threshold: GLOBAL_HOT_THRESHOLD,
    response_style: 'zentral',
    max_ai_turns: GLOBAL_MAX_AI_TURNS,
    handoff_behavior: 'stop',
    voice_mode: 'off',
    llm_model_override: null,
    temperature: 0.35,
    voice_name: 'alloy',
    media: Array.isArray(body.media) ? body.media : [],
    preset_name: body.preset_name || null,
  };
  Object.keys(data).forEach((k) => (data as any)[k] === undefined && delete (data as any)[k]);
  return reply.code(201).send((await gateway<{ data: Profile }>('create_profile', { data })).data);
});

app.patch('/api/profiles/:id', async (request, reply) => {
  const id = (request.params as any).id;
  const body: any = request.body || {};
  const allowed = new Set([
    'name', 'phone_label', 'location', 'desired_location', 'share_location', 'entry_photos', 'price_text', 'hours_text', 'avatar_url',
    'bot_enabled',
    'preset_name', 'media',
  ]);
  const unknown = Object.keys(body).filter((key) => !allowed.has(key));
  if (unknown.length) return reply.code(400).send({ error: 'Unbekannte Profilfelder: ' + unknown.join(', ') });
  if ('name' in body && !String(body.name || '').trim()) return reply.code(400).send({ error: 'Name fehlt' });
  const data: Record<string, unknown> = { id };
  for (const key of allowed) if (key in body) data[key] = body[key];
  return (await gateway<{ data: Profile }>('update_profile', { data })).data;
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

app.get('/api/pairing/:id/qr', async (request, reply) => {
  const expected = String(process.env.PAIRING_TOKEN || '');
  const supplied = String((request.query as any)?.token || '');
  if (!expected || supplied !== expected) return reply.code(404).send({ error: 'not_found' });
  const profile = await getProfile((request.params as any).id);
  await connectWhatsApp(profile);
  for (let i = 0; i < 40; i += 1) {
    const state = getConnection(profile.id);
    if (state.qr) {
      const base64 = state.qr.replace(/^data:image\/png;base64,/, '');
      reply.header('cache-control', 'no-store');
      reply.type('image/png');
      return reply.send(Buffer.from(base64, 'base64'));
    }
    if (state.status === 'online') return reply.code(409).send({ error: 'already_online' });
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  return reply.code(425).send({ error: 'qr_not_ready', status: getConnection(profile.id).status });
});

app.post('/api/profiles/:id/unlink', async (request) => {
  await unlinkWhatsApp((request.params as any).id);
  return { ok: true };
});


app.get('/api/profiles/:id/whatsapp-links', async (request) => {
  const profile = await getProfile((request.params as any).id);
  const rows = await conversations(profile.id);
  return {
    profile: { id: profile.id, name: profile.name },
    data: rows.map((conversation) => ({
      conversation_id: conversation.id,
      contact_name: conversation.contact_name || null,
      wa_jid: conversation.wa_jid,
      wa_link: waLinkFromJid(conversation.wa_jid),
      last_message_at: conversation.last_message_at || null,
    })),
  };
});

app.get('/api/profiles/:id/training-export', async (request, reply) => {
  const profile = await getProfile((request.params as any).id);
  const format = String((request.query as any)?.format || 'jsonl').toLowerCase();
  const rows = await conversations(profile.id);
  const training = [];
  for (const conversation of rows) {
    const history = (await gateway<{ data: StoredMessage[] }>('list_messages', {
      conversation_id: conversation.id,
      limit: 10000,
    })).data || [];
    training.push(buildTrainingConversation(profile, conversation, history));
  }

  const stamp = new Date().toISOString().slice(0, 10);
  const safeName = profile.name.replace(/[^a-z0-9_-]+/gi, '_').replace(/^_+|_+$/g, '') || profile.id;
  if (format === 'json') {
    reply.header('content-disposition', `attachment; filename="whatsapp-training-${safeName}-${stamp}.json"`);
    return {
      exported_at: new Date().toISOString(),
      profile: { id: profile.id, name: profile.name },
      conversations: training.filter((row) => row.messages.length > 0),
    };
  }
  if (format !== 'jsonl') return reply.code(400).send({ error: 'format muss json oder jsonl sein' });
  reply.type('application/x-ndjson; charset=utf-8');
  reply.header('content-disposition', `attachment; filename="whatsapp-training-${safeName}-${stamp}.jsonl"`);
  return toJsonl(training);
});

app.get('/api/conversations/:id/messages', async (request) => ({ data: await messages((request.params as any).id) }));

app.post('/api/conversations/:id/review/approve', async (request, reply) => {
  const id = (request.params as any).id;
  const body: any = request.body || {};
  const current = (await conversations()).find((x) => x.id === id);
  if (!current) return reply.code(404).send({ error: 'Chat nicht gefunden' });
  if (!reviewMatches(current, String(body.expected_created_at || '') || null)) {
    return reply.code(409).send({ error: 'Der KI-Vorschlag ist nicht mehr aktuell. Bitte Chat neu laden.' });
  }

  const editedText = Object.prototype.hasOwnProperty.call(body, 'text')
    ? String(body.text || '').trim()
    : String(current.pending_ai_reply || '').trim();
  const pendingHot = Boolean(current.pending_ai_hot);
  const action = String(body.action || 'send');

  if (action === 'hot') {
    if (!pendingHot) return reply.code(409).send({ error: 'Dieser Vorschlag ist kein HOT-Kandidat' });
    const updated = await updateConversation(id, {
      state: 'HOT',
      hot_score: current.pending_ai_score ?? current.hot_score ?? 0,
      hot_reason: current.pending_ai_reason || current.hot_reason || 'Vom Moderator als HOT bestätigt.',
      unread_count: 0,
      ...clearPendingReviewPatch(),
    });
    await gateway('add_event', {
      data: {
        profile_id: current.profile_id,
        conversation_id: id,
        type: 'HUMAN_GATE_HOT_APPROVED',
        payload: {
          proposed_reply: current.pending_ai_reply || '',
          proposed_hot: true,
          score: current.pending_ai_score ?? current.hot_score ?? 0,
          reason: current.pending_ai_reason || current.hot_reason || '',
          review_created_at: current.pending_ai_created_at || null,
        },
      },
    });
    void notifyHotLead({
      conversationId: current.id,
      contactName: current.contact_name || 'Neuer Lead',
      profileName: (await getProfile(current.profile_id)).name,
      preview: current.last_message_preview || '',
    }).catch((error) => app.log.warn({ err: error }, 'Push notification failed'));
    return { ok: true, action: 'hot', conversation: updated };
  }

  if (!editedText) return reply.code(400).send({ error: 'Freizugebende Antwort ist leer' });

  const sentId = await sendText(current.profile_id, current.wa_jid, editedText);
  await addMessage({
    conversation_id: id,
    wa_message_id: sentId,
    direction: 'out',
    sender: 'ai',
    kind: 'text',
    text: editedText,
  });
  const updated = await updateConversation(id, {
    state: 'AI_ACTIVE',
    ai_turns: Number(current.ai_turns || 0) + 1,
    unread_count: 0,
    last_message_preview: editedText.slice(0, 180),
    last_message_at: new Date().toISOString(),
    hot_score: null,
    hot_reason: null,
    ...clearPendingReviewPatch(),
  });
  await gateway('add_event', {
    data: {
      profile_id: current.profile_id,
      conversation_id: id,
      type: 'HUMAN_GATE_REPLY_APPROVED',
      payload: {
        edited: editedText !== String(current.pending_ai_reply || '').trim(),
        proposed_reply: String(current.pending_ai_reply || '').trim(),
        approved_reply: editedText,
        proposed_hot: Boolean(current.pending_ai_hot),
        score: current.pending_ai_score ?? current.hot_score ?? 0,
        reason: current.pending_ai_reason || current.hot_reason || '',
        review_created_at: current.pending_ai_created_at || null,
      },
    },
  });
  return { ok: true, action: 'sent', conversation: updated };
});

app.post('/api/conversations/:id/takeover', async (request, reply) => {
  const id = (request.params as any).id;
  const current = (await conversations()).find((x) => x.id === id);
  if (!current) return reply.code(404).send({ error: 'Chat nicht gefunden' });
  const gateFeedback = current.pending_ai_created_at
    ? {
        human_gate_rejected: true,
        proposed_reply: current.pending_ai_reply || '',
        proposed_hot: Boolean(current.pending_ai_hot),
        score: current.pending_ai_score ?? current.hot_score ?? 0,
        reason: current.pending_ai_reason || current.hot_reason || '',
        review_created_at: current.pending_ai_created_at,
      }
    : {};
  const updated = await updateConversation(id, { state: 'HUMAN_ACTIVE', unread_count: 0, ...clearPendingReviewPatch() });
  await gateway('add_event', {
    data: { profile_id: current.profile_id, conversation_id: id, type: 'HUMAN_TAKEOVER', payload: gateFeedback },
  });
  return updated;
});

app.post('/api/conversations/:id/return-ai', async (request, reply) => {
  const id = (request.params as any).id;
  const current = (await conversations()).find((x) => x.id === id);
  if (!current) return reply.code(404).send({ error: 'Chat nicht gefunden' });
  const updated = await updateConversation(id, { state: 'AI_ACTIVE', unread_count: 0, hot_reason: null, hot_score: null, ...clearPendingReviewPatch() });
  await gateway('add_event', { data: { profile_id: current.profile_id, conversation_id: id, type: 'RETURN_TO_AI', payload: {} } });
  return updated;
});

app.post('/api/conversations/:id/close', async (request, reply) => {
  const id = (request.params as any).id;
  const current = (await conversations()).find((x) => x.id === id);
  if (!current) return reply.code(404).send({ error: 'Chat nicht gefunden' });
  const closeFeedback = current.pending_ai_created_at
    ? {
        human_gate_rejected: true,
        proposed_reply: current.pending_ai_reply || '',
        proposed_hot: Boolean(current.pending_ai_hot),
        score: current.pending_ai_score ?? current.hot_score ?? 0,
        reason: current.pending_ai_reason || current.hot_reason || '',
        review_created_at: current.pending_ai_created_at,
      }
    : {};
  const updated = await updateConversation(id, { state: 'CLOSED', unread_count: 0, ...clearPendingReviewPatch() });
  await gateway('add_event', {
    data: { profile_id: current.profile_id, conversation_id: id, type: 'CLOSED', payload: closeFeedback },
  });
  return updated;
});

app.post('/api/conversations/:id/send', async (request, reply) => {
  const id = (request.params as any).id;
  const body: any = request.body || {};
  const text = String(body.text || '').trim();
  if (!text) return reply.code(400).send({ error: 'Nachricht leer' });
  const c = (await conversations()).find((x) => x.id === id);
  if (!c) return reply.code(404).send({ error: 'Chat nicht gefunden' });
  if (c.state !== 'HUMAN_ACTIVE') return reply.code(409).send({ error: 'Chat muss zuerst übernommen werden' });
  const currentSettings = await settings();
  const wantsVoice = Boolean(body.voice);
  let sentId: string | null;
  let outgoingKind: 'text' | 'voice' = 'text';
  if (wantsVoice) {
    try {
      const audio = await synthesizeVoice(currentSettings as LlmSettings, text, 'alloy');
      sentId = await sendVoiceAudio(c.profile_id, c.wa_jid, audio.buffer, audio.mime);
      outgoingKind = 'voice';
    } catch (voiceError) {
      app.log.warn({ err: voiceError }, 'Human TTS failed, falling back to text');
      sentId = await sendText(c.profile_id, c.wa_jid, text);
    }
  } else {
    sentId = await sendText(c.profile_id, c.wa_jid, text);
  }
  await addMessage({ conversation_id: id, wa_message_id: sentId, direction: 'out', sender: 'human', kind: outgoingKind, text });
  await updateConversation(id, { state: 'HUMAN_ACTIVE', unread_count: 0, last_message_preview: outgoingKind === 'voice' ? `🎙 ${text.slice(0, 160)}` : text.slice(0, 180), last_message_at: new Date().toISOString() });
  return { ok: true, kind: outgoingKind };
});

app.post('/api/test/qualify', async (request, reply) => {
  const body: any = request.body || {};
  const profileId = String(body.profile_id || '').trim();
  const text = String(body.text || '').trim();
  if (!profileId || !text) return reply.code(400).send({ error: 'Profil und Testnachricht fehlen' });
  if (text.length > 4000) return reply.code(400).send({ error: 'Testnachricht ist zu lang' });
  const profile = await getProfile(profileId);
  const now = new Date().toISOString();
  const testConversation = {
    id: 'playground', profile_id: profile.id, wa_jid: 'playground@s.whatsapp.net', contact_name: 'Test Lead',
    state: 'AI_ACTIVE', hot_score: null, hot_reason: null, ai_turns: 0, unread_count: 0,
    last_message_preview: text.slice(0, 180), last_message_at: now,
  } as unknown as Conversation;
  const testMessages = [{
    id: 'playground-message', conversation_id: 'playground', direction: 'in', sender: 'lead', kind: 'text', text, created_at: now,
  }] as unknown as StoredMessage[];
  try {
    const result = await qualifyLead(await settings() as LlmSettings, profile, testConversation, testMessages);
    return { ok: true, ...result };
  } catch (error) {
    app.log.warn({ err: error }, 'Playground qualification failed');
    return reply.code(502).send({ error: error instanceof Error ? error.message.slice(0, 300) : 'KI-Test fehlgeschlagen' });
  }
});

app.post('/api/conversations/:id/send-entry-photo', async (request, reply) => {
  const id = (request.params as any).id;
  const body: any = request.body || {};
  const type = String(body.type || '');
  if (!['door', 'bell'].includes(type)) return reply.code(400).send({ error: 'Ungültiger Fototyp' });
  const c = (await conversations()).find((x) => x.id === id);
  if (!c) return reply.code(404).send({ error: 'Chat nicht gefunden' });
  if (c.state !== 'HUMAN_ACTIVE') return reply.code(409).send({ error: 'Chat muss zuerst übernommen werden' });
  const profile = await getProfile(c.profile_id);
  const photos: any = profile.entry_photos || {};
  const url = String(type === 'door' ? photos.door_url || '' : photos.bell_url || '').trim();
  if (!/^https:\/\//i.test(url)) return reply.code(400).send({ error: type === 'door' ? 'Kein gültiges Haustürfoto hinterlegt' : 'Kein gültiges Klingelfoto hinterlegt' });
  const label = type === 'door' ? 'Haustür' : 'Klingel';
  const sentId = await sendImageUrl(c.profile_id, c.wa_jid, url, label);
  await addMessage({ conversation_id: id, wa_message_id: sentId, direction: 'out', sender: 'human', kind: 'image', media_url: url, text: label });
  await updateConversation(id, { state: 'HUMAN_ACTIVE', unread_count: 0, last_message_preview: `🖼 ${label}`, last_message_at: new Date().toISOString() });
  return { ok: true, kind: 'image', type };
});

app.post('/api/conversations/:id/send-location', async (request, reply) => {
  const id = (request.params as any).id;
  const c = (await conversations()).find((x) => x.id === id);
  if (!c) return reply.code(404).send({ error: 'Chat nicht gefunden' });
  if (c.state !== 'HUMAN_ACTIVE') return reply.code(409).send({ error: 'Chat muss zuerst übernommen werden' });
  const profile = await getProfile(c.profile_id);
  const loc: any = profile.share_location;
  const latitude = Number(loc?.latitude);
  const longitude = Number(loc?.longitude);
  const address = String(loc?.address || '').trim();
  const label = String(loc?.label || profile.name || address).trim();
  if (!address || !Number.isFinite(latitude) || latitude < -90 || latitude > 90 || !Number.isFinite(longitude) || longitude < -180 || longitude > 180) {
    return reply.code(400).send({ error: 'Für dieses Profil ist keine gültige Wahladresse mit Koordinaten hinterlegt' });
  }
  const sentId = await sendLocation(c.profile_id, c.wa_jid, latitude, longitude, label, address);
  await addMessage({ conversation_id: id, wa_message_id: sentId, direction: 'out', sender: 'human', kind: 'location', text: `📍 ${label}${label !== address ? ` · ${address}` : ''}` });
  await updateConversation(id, { state: 'HUMAN_ACTIVE', unread_count: 0, last_message_preview: `📍 ${address}`.slice(0, 180), last_message_at: new Date().toISOString() });
  return { ok: true, kind: 'location' };
});

app.post('/api/conversations/:id/send-media', async (request, reply) => {
  const id = (request.params as any).id;
  const body: any = request.body || {};
  const url = String(body.url || '').trim();
  if (!/^https:\/\//i.test(url)) return reply.code(400).send({ error: 'Nur HTTPS-Bilder sind erlaubt' });
  const c = (await conversations()).find((x) => x.id === id);
  if (!c) return reply.code(404).send({ error: 'Chat nicht gefunden' });
  if (c.state !== 'HUMAN_ACTIVE') return reply.code(409).send({ error: 'Chat muss zuerst übernommen werden' });
  const profile = await getProfile(c.profile_id);
  const allowed = Array.isArray(profile.media) ? profile.media.filter((x): x is string => typeof x === 'string') : [];
  if (!allowed.includes(url)) return reply.code(403).send({ error: 'Bild gehört nicht zur Medienliste dieses Profils' });
  const sentId = await sendImageUrl(c.profile_id, c.wa_jid, url);
  await addMessage({ conversation_id: id, wa_message_id: sentId, direction: 'out', sender: 'human', kind: 'image', media_url: url, text: '' });
  await updateConversation(id, { state: 'HUMAN_ACTIVE', unread_count: 0, last_message_preview: '🖼 Bild', last_message_at: new Date().toISOString() });
  return { ok: true, kind: 'image' };
});

app.post('/api/conversations/:id/send-tts', async (request, reply) => {
  const id = (request.params as any).id;
  const body: any = request.body || {};
  const text = String(body.text || '').trim();
  if (!text) return reply.code(400).send({ error: 'Text fehlt' });
  if (text.length > 1200) return reply.code(400).send({ error: 'Text ist zu lang (maximal 1200 Zeichen)' });
  const c = (await conversations()).find((x) => x.id === id);
  if (!c) return reply.code(404).send({ error: 'Chat nicht gefunden' });
  if (c.state !== 'HUMAN_ACTIVE') return reply.code(409).send({ error: 'Chat muss zuerst übernommen werden' });
  const currentSettings = await settings();
  if (!currentSettings.voice_enabled) return reply.code(409).send({ error: 'Text-zu-Sprache ist in den Einstellungen deaktiviert' });
  try {
    const audio = await synthesizeVoice(currentSettings as LlmSettings, text, 'alloy');
    const sentId = await sendVoiceAudio(c.profile_id, c.wa_jid, audio.buffer, audio.mime);
    await addMessage({ conversation_id: id, wa_message_id: sentId, direction: 'out', sender: 'human', kind: 'voice', text });
    await updateConversation(id, { state: 'HUMAN_ACTIVE', unread_count: 0, last_message_preview: ('🎙 ' + text).slice(0, 180), last_message_at: new Date().toISOString() });
    return { ok: true, kind: 'voice' };
  } catch (error) {
    app.log.warn({ err: error }, 'Manual TTS send failed');
    return reply.code(502).send({ error: error instanceof Error ? error.message.slice(0, 300) : 'Sprachausgabe fehlgeschlagen' });
  }
});

app.post('/api/conversations/:id/send-voice-upload', { bodyLimit: 6 * 1024 * 1024 }, async (request, reply) => {
  const id = (request.params as any).id;
  const body: any = request.body || {};
  const mimeRaw = String(body.mime || '').trim().toLowerCase();
  const mime = mimeRaw.split(';')[0];
  const allowedMime = new Set(['audio/webm', 'audio/ogg', 'audio/mp4', 'audio/mpeg']);
  if (!allowedMime.has(mime)) return reply.code(400).send({ error: 'Nicht unterstütztes Audioformat' });
  const encoded = String(body.audio_base64 || '').trim();
  if (!encoded || !/^[A-Za-z0-9+/]+={0,2}$/.test(encoded)) return reply.code(400).send({ error: 'Ungültige Audiodaten' });
  const audio = Buffer.from(encoded, 'base64');
  if (!audio.length) return reply.code(400).send({ error: 'Audiodatei ist leer' });
  if (audio.length > 4 * 1024 * 1024) return reply.code(413).send({ error: 'Sprachnachricht ist zu groß (maximal 4 MB)' });
  const c = (await conversations()).find((x) => x.id === id);
  if (!c) return reply.code(404).send({ error: 'Chat nicht gefunden' });
  if (c.state !== 'HUMAN_ACTIVE') return reply.code(409).send({ error: 'Chat muss zuerst übernommen werden' });
  try {
    const sentId = await sendVoiceAudio(c.profile_id, c.wa_jid, audio, mime);
    await addMessage({ conversation_id: id, wa_message_id: sentId, direction: 'out', sender: 'human', kind: 'voice', text: 'Sprachnachricht' });
    await updateConversation(id, { state: 'HUMAN_ACTIVE', unread_count: 0, last_message_preview: '🎙 Sprachnachricht', last_message_at: new Date().toISOString() });
    return { ok: true, kind: 'voice' };
  } catch (error) {
    app.log.warn({ err: error }, 'Recorded voice send failed');
    return reply.code(502).send({ error: error instanceof Error ? error.message.slice(0, 300) : 'Sprachnachricht konnte nicht gesendet werden' });
  }
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
  void notifyHotLead({ conversationId: c.id, contactName: 'Demo Lead', profileName: p.name, preview: 'Ja, ich würde gern heute noch einen Termin machen.' }).catch(() => undefined);
  return { ok: true, id: c.id };
});

app.setNotFoundHandler((request, reply) => {
  if (request.url.startsWith('/api/')) return reply.code(404).send({ error: 'not_found' });
  return reply.sendFile('index.html');
});

const initialProfiles = await profiles().catch((error) => { app.log.error({ err: error }, 'Initial profile load failed'); return []; });
restoreWhatsAppSessions(initialProfiles).catch((error) => app.log.error(error));
void getVapidPublicKey().catch((error) => app.log.warn({ err: error }, 'Push initialization failed'));

await app.listen({ port, host: '0.0.0.0' });

if (process.env.RUN_TRAINING_SIMULATION === 'true') {
  const simulationRunId = String(process.env.SIMULATION_RUN_ID || new Date().toISOString()).replace(/[^a-zA-Z0-9._-]+/g, '-');
  const simulationProfileId = String(process.env.SIMULATION_PROFILE_ID || '').trim();
  const simulationLimit = Math.max(1, Math.min(30, Number(process.env.SIMULATION_LIMIT || 30)));
  const persistSimulation = process.env.SIMULATION_PERSIST === 'true';
  setTimeout(async () => {
    if (!simulationProfileId) {
      app.log.error({ simulationRunId }, 'TRAINING_SIMULATION_SKIPPED: SIMULATION_PROFILE_ID missing');
      return;
    }
    try {
      const profile = await getProfile(simulationProfileId);
      const result = await runTrainingSimulation(
        await settings() as LlmSettings,
        profile,
        (row) => app.log.warn({ simulationRunId, ...row }, 'TRAINING_SIMULATION_CASE'),
        simulationLimit,
      );

      if (persistSimulation) {
        let index = 0;
        for (const row of result.cases) {
          index += 1;
          const last = row.transcript.at(-1)?.text || row.id;
          const timestamp = new Date(Date.now() + index * 1000).toISOString();
          const conversation = (await gateway<{ data: Conversation }>('upsert_conversation', {
            data: {
              profile_id: profile.id,
              wa_jid: `sim-${simulationRunId}-${row.id}@simulation.invalid`,
              contact_name: `SIM ${row.persona === 'cambodia' ? 'Cambodia' : 'Kenya'} · ${String(index).padStart(2, '0')} · ${row.id}`,
              state: row.actualOutcome === 'arrived' ? 'HOT' : 'CLOSED',
              hot_score: row.actualOutcome === 'arrived' ? 0.96 : null,
              hot_reason: row.actualOutcome === 'arrived'
                ? `Simulation: bestätigter Lead, HOT ab Turn ${row.hotAtTurn || '-'}, Ankunft erreicht`
                : `Simulation: ${row.actualOutcome}; Human-Gate-Freigaben ${row.moderatorApprovals}${row.error ? `; ${row.error}` : ''}`,
              ai_turns: row.transcript.filter((message) => message.sender === 'ai').length,
              unread_count: 0,
              last_message_preview: `[${row.actualOutcome}] ${last}`.slice(0, 180),
              last_message_at: timestamp,
            },
          })).data;
          for (let i = 0; i < row.transcript.length; i += 1) {
            const message = row.transcript[i];
            await addMessage({
              conversation_id: conversation.id,
              direction: message.sender === 'lead' ? 'in' : 'out',
              sender: message.sender,
              kind: 'text',
              text: message.text,
              created_at: new Date(Date.now() + index * 1000 + i * 100).toISOString(),
            });
          }
        }
        app.log.warn({ simulationRunId, persisted: result.cases.length, profileId: profile.id }, 'TRAINING_SIMULATION_PERSISTED');
      }

      app.log.warn({ simulationRunId, result }, 'TRAINING_SIMULATION_COMPLETE');
    } catch (error) {
      app.log.error({
        simulationRunId,
        error: error instanceof Error ? error.message : String(error),
      }, 'TRAINING_SIMULATION_FAILED');
    }
  }, 1500);
}
