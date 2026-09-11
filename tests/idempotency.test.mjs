import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const server = readFileSync('src/server.ts','utf8');

test('duplicate inbound WhatsApp IDs are rejected before counters or AI run', () => {
  const marker = "setInboundHandler(async (profileId, jid, name, text, waMessageId";
  const start = server.indexOf(marker);
  const end = server.indexOf("app.get('/health'", start);
  assert.ok(start >= 0 && end > start, 'inbound handler missing');
  const handler = server.slice(start,end);
  const duplicateCheck = handler.indexOf("m.wa_message_id === waMessageId");
  const counterUpdate = handler.indexOf("unread_count: (existing.unread_count || 0) + 1");
  const aiRun = handler.indexOf('qualifyLead(');
  assert.ok(duplicateCheck >= 0, 'duplicate message check missing');
  assert.ok(counterUpdate > duplicateCheck, 'duplicate check must happen before unread counter update');
  assert.ok(aiRun > duplicateCheck, 'duplicate check must happen before AI qualification');
  assert.match(handler,/Duplicate WhatsApp message ignored/);
});
