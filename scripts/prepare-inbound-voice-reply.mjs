import { readFileSync, writeFileSync } from 'node:fs';

const path = 'src/server.ts';
let source = readFileSync(path, 'utf8');

const before = `      const sentId = await sendText(profileId, jid, outgoingText);
      await addMessage({
        conversation_id: conversation.id,
        wa_message_id: sentId,
        direction: 'out',
        sender: 'ai',
        kind: 'text',
        text: outgoingText,
      });
      await updateConversation(conversation.id, {
        ai_turns: turn,
        last_message_preview: outgoingText.slice(0, 180),
        last_message_at: new Date().toISOString(),
      });`;

const after = `      let sentId: string | null = null;
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
        last_message_preview: outgoingKind === 'voice' ? \`🎙 \${outgoingText.slice(0, 160)}\` : outgoingText.slice(0, 180),
        last_message_at: new Date().toISOString(),
      });`;

if (source.includes(after)) {
  console.log('prepare-inbound-voice-reply: already applied');
} else if (source.includes(before)) {
  source = source.replace(before, after);
  writeFileSync(path, source);
  console.log('prepare-inbound-voice-reply: voice-note reply routing applied');
} else {
  throw new Error('prepare-inbound-voice-reply: expected AI reply block not found');
}
