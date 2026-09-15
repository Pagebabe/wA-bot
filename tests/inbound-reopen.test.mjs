import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

test('fresh inbound message reopens a closed conversation', () => {
  execFileSync(process.execPath, ['scripts/prepare-inbound-reopen.mjs'], { stdio: 'pipe' });
  const server = readFileSync('src/server.ts', 'utf8');
  assert.match(server, /existing\.state === 'CLOSED'/);
  assert.match(server, /state: profile\.bot_enabled \? 'AI_ACTIVE' : 'HUMAN_ACTIVE'/);
  assert.match(server, /ai_turns: 0/);
  assert.match(server, /hot_reason: null/);
});
