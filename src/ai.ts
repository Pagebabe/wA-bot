import type { Conversation, Profile, StoredMessage } from './store.js';

export type LlmSettings = {
  llm_base_url?: string | null;
  llm_model?: string | null;
  llm_api_key_encrypted?: string | null;
  voice_enabled?: boolean | null;
  voice_model?: string | null;
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
  const apiKey = settings.llm_api_key_encrypted;
  const model = profile.llm_model_override || settings.llm_model;
  const base = settings.llm_base_url;
  if (!apiKey || !model || !base) throw new Error('LLM is not configured');

  const transcript = messages.slice(-18).map((m) => `${m.sender}: ${m.text || `[${m.kind}]`}`).join('\n');
  const system = [
    profile.system_prompt,
    `Profil: ${profile.name}`,
    profile.location ? `Ort: ${profile.location}` : '',
    profile.price_text ? `Preise: ${profile.price_text}` : '',
    profile.hours_text ? `Zeiten: ${profile.hours_text}` : '',
    `Qualifizierungsregel: ${profile.qualification_prompt}`,
    `HOT-Schwelle: ${profile.hot_threshold}`,
    `Antwortstil: ${profile.response_style}. Antworte knapp und menschlich, keine langen Texte.`,
    'Du darfst keinen Termin verbindlich buchen. Sobald der Lead HOT ist, wird an einen Menschen übergeben.',
    'Gib ausschließlich JSON zurück: {"reply":"...","hot":true|false,"score":0.0,"reason":"..."}.',
    'Wenn hot=true, darf reply leer sein. score muss zwischen 0 und 1 liegen.',
  ].filter(Boolean).join('\n');

  const response = await fetchLlm(`${normalizeBaseUrl(base)}/chat/completions`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({
      model,
      temperature: Number(profile.temperature ?? 0.35),
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
  const score = Math.max(0, Math.min(1, Number(parsed.score ?? 0)));
  return {
    reply: typeof parsed.reply === 'string' ? parsed.reply.trim() : '',
    hot: Boolean(parsed.hot) || score >= Number(profile.hot_threshold || 0.8),
    score,
    reason: typeof parsed.reason === 'string' ? parsed.reason.slice(0, 500) : '',
  };
}

export async function synthesizeVoice(settings: LlmSettings, text: string, voice = 'alloy'): Promise<Buffer> {
  const apiKey = settings.llm_api_key_encrypted;
  const base = settings.llm_base_url;
  if (!apiKey || !base) throw new Error('Voice API is not configured');
  const model = settings.voice_model || 'gpt-4o-mini-tts';
  const response = await fetchLlm(`${normalizeBaseUrl(base)}/audio/speech`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({ model, voice, input: text, format: 'mp3' }),
  });
  if (!response.ok) throw new Error(`TTS HTTP ${response.status}: ${(await response.text()).slice(0, 300)}`);
  return Buffer.from(await response.arrayBuffer());
}

export async function transcribeAudio(settings: LlmSettings, audio: Buffer, mime = 'audio/ogg'): Promise<string> {
  const apiKey = settings.llm_api_key_encrypted;
  const base = settings.llm_base_url;
  if (!apiKey || !base) throw new Error('Transcription API is not configured');
  const form = new FormData();
  form.append('model', 'gpt-4o-mini-transcribe');
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
