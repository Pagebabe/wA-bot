import type { Conversation, Profile, StoredMessage } from './store.js';
import { buildSystemPrompt } from './chat-policy.js';
import { analyzeTrainingSignals, buildTrainingGuidance } from './training-patterns.js';

export type LlmSettings = {
  llm_base_url?: string | null;
  llm_model?: string | null;
  llm_api_key_encrypted?: string | null;
  voice_enabled?: boolean | null;
  voice_model?: string | null;
  tts_api_key?: string | null;
  tts_voice_id?: string | null;
  tts_model?: string | null;
  stt_api_key?: string | null;
  stt_base_url?: string | null;
  stt_model?: string | null;
};

export type Qualification = {
  reply: string;
  hot: boolean;
  score: number;
  reason: string;
};

const LLM_ATTEMPT_TIMEOUT_MS = 50_000;
const LLM_MAX_ATTEMPTS = 2;

function normalizeBaseUrl(input: string): string {
  return input.replace(/\/$/, '').replace(/\/v1$/, '') + '/v1';
}

function extractJson(text: string): unknown {
  const trimmed = text.trim();
  try { return JSON.parse(trimmed); } catch {}
  const start = trimmed.indexOf('{');
  const end = trimmed.lastIndexOf('}');
  if (start >= 0 && end > start) return JSON.parse(trimmed.slice(start, end + 1));
  throw new Error('LLM returned no JSON object');
}

function isRetryableStatus(status: number): boolean {
  return status === 408 || status === 425 || status === 429 || status >= 500;
}

async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchLlm(url: string, init: RequestInit): Promise<Response> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= LLM_MAX_ATTEMPTS; attempt += 1) {
    try {
      const response = await fetch(url, {
        ...init,
        signal: AbortSignal.timeout(LLM_ATTEMPT_TIMEOUT_MS),
      });
      if (!isRetryableStatus(response.status) || attempt === LLM_MAX_ATTEMPTS) return response;
      await response.arrayBuffer().catch(() => undefined);
      lastError = new Error(`LLM HTTP ${response.status}`);
    } catch (error) {
      lastError = error;
      if (attempt === LLM_MAX_ATTEMPTS) break;
    }
    await sleep(350 * attempt);
  }
  throw lastError instanceof Error ? lastError : new Error('LLM request failed');
}

export async function qualifyLead(
  settings: LlmSettings,
  profile: Profile,
  conversation: Conversation,
  messages: StoredMessage[],
): Promise<Qualification> {
  const signals = analyzeTrainingSignals(messages);
  if (signals.abortNow) {
    return {
      reply: 'Alles klar 😊 Melde dich einfach wieder, wenn es für dich passt.',
      hot: false,
      score: 0.08,
      reason: 'Aktuelle Nachricht signalisiert Absage oder Abbruch.',
    };
  }
  if (signals.hesitationNow) {
    return {
      reply: 'Kein Stress 😊 Meld dich einfach, wenn du sicher bist.',
      hot: false,
      score: 0.18,
      reason: 'Kontakt ist aktuell unentschlossen; keine weitere Bestätigungsfrage.',
    };
  }
  if (signals.arrivalNow) {
    return { reply: '', hot: true, score: 0.99, reason: 'Kontakt ist bereits vor Ort; sofortige Übergabe.' };
  }
  if (signals.hasTemporalWish && signals.hasDuration && signals.hasActiveCommitment) {
    return { reply: '', hot: true, score: 0.96, reason: 'Zeitwunsch, Dauer und klare aktive Zusage sind vorhanden.' };
  }
  if (signals.hasTemporalWish && signals.hasDuration && !signals.hasActiveCommitment) {
    return {
      reply: 'Perfekt 😊 Soll ich das so zur Bestätigung weitergeben?',
      hot: false,
      score: 0.68,
      reason: 'Zeit und Dauer sind vorhanden, aber eine klare Zusage fehlt noch.',
    };
  }
  if (signals.hasTemporalWish && !signals.hasDuration) {
    return { reply: 'Wie lange magst du bleiben? 😊', hot: false, score: 0.5, reason: 'Konkreter Zeitwunsch vorhanden, Dauer fehlt.' };
  }
  if (!signals.hasTemporalWish && signals.hasDayMention && !signals.hasDuration) {
    return { reply: 'Welche Uhrzeit passt dir? 😊', hot: false, score: 0.35, reason: 'Tag ist bekannt, konkrete Uhrzeit fehlt.' };
  }
  if (!signals.hasTemporalWish && signals.hasDuration) {
    return { reply: 'Wann magst du kommen? 😊', hot: false, score: 0.45, reason: 'Dauer vorhanden, konkrete Uhrzeit fehlt.' };
  }

  const apiKey = settings.llm_api_key_encrypted;
  const model = settings.llm_model;
  const base = settings.llm_base_url;
  if (!apiKey || !model || !base) throw new Error('LLM is not configured');

  const transcript = messages.slice(-18).map((m) => `${m.sender}: ${m.text || `[${m.kind}]`}`).join('\n');
  const system = [buildSystemPrompt(profile), buildTrainingGuidance(profile, messages)].join('\n\n');

  const response = await fetchLlm(`${normalizeBaseUrl(base)}/chat/completions`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({
      model,
      temperature: 0.35,
      max_tokens: 220,
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: `Aktueller Chat:\n${transcript}\n\nBewerte jetzt den Lead.` },
      ],
    }),
  });
  if (!response.ok) throw new Error(`LLM HTTP ${response.status}: ${(await response.text()).slice(0, 300)}`);
  const payload: any = await response.json();
  const content = payload?.choices?.[0]?.message?.content;
  if (typeof content !== 'string') throw new Error('LLM response has no message content');
  const parsed: any = extractJson(content);
  const score = Math.max(0, Math.min(0.79, Number(parsed.score ?? 0)));
  return {
    reply: typeof parsed.reply === 'string' ? parsed.reply.trim() : '',
    hot: false,
    score,
    reason: typeof parsed.reason === 'string' ? parsed.reason.slice(0, 500) : '',
  };
}

export type SynthesizedVoice = { buffer: Buffer; mime: string; format: string };

export async function synthesizeVoice(settings: LlmSettings, text: string, voice = 'alloy'): Promise<SynthesizedVoice> {
  const input = String(text || '').trim();
  if (!input || input.length > 1200) throw new Error('Voice text is invalid');
  const elevenKey = settings.tts_api_key || process.env.ELEVENLABS_API_KEY;
  const elevenVoice = settings.tts_voice_id || process.env.ELEVENLABS_VOICE_ID;
  if (elevenKey && elevenVoice) {
    const model = settings.tts_model || process.env.ELEVENLABS_MODEL_ID || 'eleven_v3';
    const voiceSettings = model === 'eleven_v3'
      ? { stability: 0.5 }
      : { stability: 0.45, similarity_boost: 0.78, style: 0, use_speaker_boost: true };
    const response = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(elevenVoice)}?output_format=opus_48000_64`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'xi-api-key': elevenKey },
      body: JSON.stringify({
        text: input,
        model_id: model,
        voice_settings: voiceSettings,
      }),
    });
    if (!response.ok) throw new Error(`TTS HTTP ${response.status}: ${(await response.text()).slice(0, 300)}`);
    return { buffer: Buffer.from(await response.arrayBuffer()), mime: 'audio/ogg; codecs=opus', format: 'opus_48000_64' };
  }

  const apiKey = settings.llm_api_key_encrypted;
  const base = settings.llm_base_url;
  if (!apiKey || !base) throw new Error('Voice API is not configured');
  const model = settings.voice_model || 'gpt-4o-mini-tts';
  const response = await fetchLlm(`${normalizeBaseUrl(base)}/audio/speech`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({ model, voice, input, response_format: 'opus' }),
  });
  if (!response.ok) throw new Error(`TTS HTTP ${response.status}: ${(await response.text()).slice(0, 300)}`);
  return { buffer: Buffer.from(await response.arrayBuffer()), mime: 'audio/ogg; codecs=opus', format: 'opus' };
}

export async function transcribeAudio(settings: LlmSettings, audio: Buffer, mime = 'audio/ogg'): Promise<string> {
  const apiKey = settings.stt_api_key || process.env.OPENAI_API_KEY || settings.llm_api_key_encrypted;
  const base = settings.stt_base_url || process.env.STT_BASE_URL || settings.llm_base_url;
  if (!apiKey || !base) throw new Error('Transcription API is not configured');
  const form = new FormData();
  form.append('model', settings.stt_model || process.env.STT_MODEL || 'gpt-4o-mini-transcribe');
  const copy = Uint8Array.from(audio);
  form.append('file', new Blob([copy.buffer as ArrayBuffer], { type: mime }), 'voice.ogg');
  const response = await fetchLlm(`${normalizeBaseUrl(base)}/audio/transcriptions`, {
    method: 'POST',
    headers: { authorization: `Bearer ${apiKey}` },
    body: form,
  });
  if (!response.ok) throw new Error(`STT HTTP ${response.status}: ${(await response.text()).slice(0, 300)}`);
  const payload: any = await response.json();
  return String(payload?.text || '').trim();
}
