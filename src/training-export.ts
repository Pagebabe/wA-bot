import type { Conversation, Profile, StoredMessage } from './store.js';

export type TrainingConversation = {
  profile_id: string;
  profile_name: string;
  conversation_id: string;
  contact_name: string | null;
  wa_jid: string;
  wa_link: string | null;
  messages: Array<{
    role: 'user' | 'assistant';
    sender: 'lead' | 'human' | 'ai';
    kind: StoredMessage['kind'];
    content: string;
    created_at: string;
    wa_message_id: string | null;
  }>;
};

export function waLinkFromJid(jid: string): string | null {
  const bare = String(jid || '').split('@')[0].split(':')[0];
  const digits = bare.replace(/\D/g, '');
  return digits ? `https://wa.me/${digits}` : null;
}

export function buildTrainingConversation(
  profile: Profile,
  conversation: Conversation,
  messages: StoredMessage[],
): TrainingConversation {
  const usable = messages
    .filter((message) => ['lead', 'human', 'ai'].includes(message.sender))
    .filter((message) => ['text', 'voice'].includes(message.kind))
    .filter((message) => typeof message.text === 'string' && message.text.trim())
    .map((message) => ({
      role: message.sender === 'lead' ? 'user' as const : 'assistant' as const,
      sender: message.sender as 'lead' | 'human' | 'ai',
      kind: message.kind,
      content: String(message.text).trim(),
      created_at: message.created_at,
      wa_message_id: message.wa_message_id || null,
    }));

  return {
    profile_id: profile.id,
    profile_name: profile.name,
    conversation_id: conversation.id,
    contact_name: conversation.contact_name || null,
    wa_jid: conversation.wa_jid,
    wa_link: waLinkFromJid(conversation.wa_jid),
    messages: usable,
  };
}

export function toJsonl(rows: TrainingConversation[]) {
  return rows
    .filter((row) => row.messages.length > 0)
    .map((row) => JSON.stringify({
      profile_id: row.profile_id,
      conversation_id: row.conversation_id,
      contact_name: row.contact_name,
      wa_link: row.wa_link,
      messages: row.messages.map((message) => ({
        role: message.role,
        content: message.content,
      })),
      metadata: {
        profile_name: row.profile_name,
        wa_jid: row.wa_jid,
        source: 'whatsapp',
      },
    }))
    .join('\n');
}
