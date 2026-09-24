import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const server = readFileSync('src/server.ts', 'utf8');

test('human-gate approval persists proposal and moderator correction for training', () => {
  const start = server.indexOf("type: 'HUMAN_GATE_REPLY_APPROVED'");
  assert.ok(start >= 0, 'approval event missing');
  const block = server.slice(start, start + 1200);
  assert.match(block, /proposed_reply/);
  assert.match(block, /approved_reply/);
  assert.match(block, /edited:/);
  assert.match(block, /review_created_at/);
});

test('human takeover preserves rejected AI proposal as negative feedback', () => {
  const start = server.indexOf("const gateFeedback");
  assert.ok(start >= 0, 'takeover feedback missing');
  const block = server.slice(start, start + 1400);
  assert.match(block, /human_gate_rejected: true/);
  assert.match(block, /proposed_reply/);
  assert.match(block, /proposed_hot/);
  assert.match(block, /HUMAN_TAKEOVER/);
});
