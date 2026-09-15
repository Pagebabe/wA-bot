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
  "      unread_count: (existing.unread_count || 0) + 1,\n    });",
  "      unread_count: (existing.unread_count || 0) + 1,\n      ...(existing.state === 'CLOSED' ? {\n        state: profile.bot_enabled ? 'AI_ACTIVE' : 'HUMAN_ACTIVE',\n        ai_turns: 0,\n        hot_score: 0,\n        hot_reason: null,\n      } : {}),\n    });",
  'reopen closed conversation on inbound message',
);

writeFileSync(path, source);
console.log('prepare-inbound-reopen: closed conversations reopen on fresh inbound messages');
