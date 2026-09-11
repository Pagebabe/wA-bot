const gatewayUrl = process.env.SUPABASE_GATEWAY_URL ?? '';
const gatewaySecret = process.env.WA_BOT_GATEWAY_SECRET ?? '';

if (!gatewayUrl || !gatewaySecret) {
  throw new Error('Missing SUPABASE_GATEWAY_URL or WA_BOT_GATEWAY_SECRET');
}

export async function gateway<T = unknown>(action: string, payload: Record<string, unknown> = {}): Promise<T> {
  const response = await fetch(gatewayUrl, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-wa-bot-secret': gatewaySecret,
    },
    body: JSON.stringify({ action, ...payload }),
  });
  const body: any = await response.json().catch(() => ({ error: `HTTP ${response.status}` }));
  if (!response.ok) {
    const message = typeof body?.error === 'string' ? body.error : `Gateway error ${response.status}`;
    throw new Error(message);
  }
  return body as T;
}

export type Profile = {
  id: string;
  name: string;
  phone_label?: string | null;
  location?: string | null;
  price_text?: string | null;
  hours_text?: string | null;
  avatar_url?: string | null;
  status: 'offline' | 'connecting' | 'online' | 'error';
  bot_enabled: boolean;
  system_prompt: string;
  qualification_prompt: string;
  hot_threshold: number;
  response_style: string;
  max_ai_turns: number;
  handoff_behavior: 'stop' | 'assist' | 'continue';
  voice_mode: 'off' | 'human_tts' | 'ai_tts';
  llm_model_override?: string | null;
  temperature?: number | null;
  voice_name?: string | null;
  media?: unknown[] | null;
  quick_replies?: string[] | null;
  preset_name?: string | null;
};

export type Conversation = {
  id: string;
  profile_id: string;
  wa_jid: string;
  contact_name?: string | null;
  state: 'NEW' | 'AI_ACTIVE' | 'HOT' | 'HUMAN_ACTIVE' | 'CLOSED' | 'PAUSED' | 'WA_OFFLINE' | 'AI_ERROR';
  hot_score?: number | null;
  hot_reason?: string | null;
  ai_turns: number;
  unread_count: number;
  last_message_preview?: string | null;
  last_message_at?: string | null;
};

export type StoredMessage = {
  id: string;
  conversation_id: string;
  wa_message_id?: string | null;
  direction: 'in' | 'out';
  sender: 'lead' | 'ai' | 'human' | 'system';
  kind: 'text' | 'voice' | 'image' | 'system';
  text?: string | null;
  media_url?: string | null;
  created_at: string;
};
