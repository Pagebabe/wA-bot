import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const server = readFileSync('src/server.ts','utf8');

test('AI result is discarded if human ownership changes during model latency', () => {
  const q = server.indexOf('const result = await qualifyLead');
  const recheck = server.indexOf("latestConversation.state !== 'AI_ACTIVE'", q);
  const send = server.indexOf('sendText(profileId, jid', q);
  const hot = server.indexOf("state: 'HOT'", q);
  assert.ok(q >= 0 && recheck > q, 'post-LLM ownership recheck missing');
  assert.ok(send > recheck, 'AI send must happen after ownership recheck');
  assert.ok(hot > recheck, 'HOT transition must happen after ownership recheck');
  assert.match(server,/AI result discarded after ownership\/state changed/);
});

test('human state transitions are written to audit events', () => {
  assert.match(server,/type: 'HUMAN_TAKEOVER'/);
  assert.match(server,/type: 'RETURN_TO_AI'/);
  assert.match(server,/type: 'CLOSED'/);
});
