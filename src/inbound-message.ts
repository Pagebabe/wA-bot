export type InboundConversation = {
  id: string;
  profile_id: string;
  wa_jid: string;
  contact_name?: string | null;
  state: string;
  unread_count?: number | null;
  [key: string]: unknown;
};

export type InboundMessageDeps = {
  findConversation(profileId: string, jid: string): Promise<InboundConversation | null>;
  updateConversation(id: string, patch: Record<string, unknown>): Promise<InboundConversation>;
  upsertConversation(data: Record<string, unknown>): Promise<InboundConversation>;
  addMessage(data: Record<string, unknown>): Promise<unknown>;
};

export type PersistInboundInput = {
  profileId: string;
  jid: string;
  name: string | null;
  text: string;
  waMessageId: string | null;
  raw: unknown;
  kind: 'text' | 'voice';
  botEnabled: boolean;
  now: string;
};

export async function persistInboundMessage(deps: InboundMessageDeps, input: PersistInboundInput): Promise<InboundConversation> {
  const existing = await deps.findConversation(input.profileId, input.jid);
  let conversation: InboundConversation;
  const preview = input.kind === 'voice' ? `🎙 ${input.text.slice(0, 160)}` : input.text.slice(0, 180);

  if (existing) {
    conversation = await deps.updateConversation(existing.id, {
      contact_name: input.name || existing.contact_name,
      last_message_preview: preview,
      last_message_at: input.now,
      unread_count: Number(existing.unread_count || 0) + 1,
      ...(existing.state === 'CLOSED' ? {
        state: input.botEnabled ? 'AI_ACTIVE' : 'HUMAN_ACTIVE',
        ai_turns: 0,
        hot_score: 0,
        hot_reason: null,
      } : {}),
    });
  } else {
    conversation = await deps.upsertConversation({
      profile_id: input.profileId,
      wa_jid: input.jid,
      contact_name: input.name,
      state: 'AI_ACTIVE',
      last_message_preview: preview,
      last_message_at: input.now,
      unread_count: 1,
    });
  }

  await deps.addMessage({
    conversation_id: conversation.id,
    wa_message_id: input.waMessageId,
    direction: 'in',
    sender: 'lead',
    kind: input.kind,
    text: input.text,
    raw: input.raw,
  });

  return conversation;
}
