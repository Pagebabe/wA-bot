import { readFileSync, writeFileSync } from 'node:fs';

function replaceRequired(source, before, after, label) {
  if (source.includes(after)) return source;
  if (!source.includes(before)) throw new Error(`prepare-inbound-reopen: pattern missing: ${label}`);
  return source.replace(before, after);
}

const path = 'src/server.ts';
let source = readFileSync(path, 'utf8');

source = replaceRequired(
  source,
  "import { getVapidPublicKey, notifyHotLead, savePushSubscription } from './push.js';",
  "import { getVapidPublicKey, notifyHotLead, savePushSubscription } from './push.js';\nimport { persistInboundMessage } from './inbound-message.js';",
  'inbound helper import',
);

const before = `  const existing = (await conversations(profileId)).find((x) => x.wa_jid === jid);\n  const now = new Date().toISOString();\n  let conversation: Conversation;\n\n  if (existing) {\n    conversation = await updateConversation(existing.id, {\n      contact_name: name || existing.contact_name,\n      last_message_preview: kind === 'voice' ? \`🎙 \${text.slice(0, 160)}\` : text.slice(0, 180),\n      last_message_at: now,\n      unread_count: (existing.unread_count || 0) + 1,\n    });\n  } else {\n    conversation = (await gateway<{ data: Conversation }>('upsert_conversation', {\n      data: {\n        profile_id: profileId,\n        wa_jid: jid,\n        contact_name: name,\n        state: 'AI_ACTIVE',\n        last_message_preview: kind === 'voice' ? \`🎙 \${text.slice(0, 160)}\` : text.slice(0, 180),\n        last_message_at: now,\n        unread_count: 1,\n      },\n    })).data;\n  }\n\n  await addMessage({\n    conversation_id: conversation.id,\n    wa_message_id: waMessageId,\n    direction: 'in',\n    sender: 'lead',\n    kind,\n    text,\n    raw,\n  });`;

const after = `  const now = new Date().toISOString();\n  const conversation = await persistInboundMessage({\n    findConversation: async (pid, remoteJid) => (await conversations(pid)).find((x) => x.wa_jid === remoteJid) || null,\n    updateConversation: async (id, patch) => updateConversation(id, patch),\n    upsertConversation: async (data) => (await gateway<{ data: Conversation }>('upsert_conversation', { data })).data,\n    addMessage: async (data) => addMessage(data),\n  }, {\n    profileId,\n    jid,\n    name,\n    text,\n    waMessageId,\n    raw,\n    kind,\n    botEnabled: profile.bot_enabled,\n    now,\n  }) as Conversation;`;

source = replaceRequired(source, before, after, 'route inbound persistence through helper');

writeFileSync(path, source);
console.log('prepare-inbound-reopen: inbound persistence uses behavioral-testable helper');
