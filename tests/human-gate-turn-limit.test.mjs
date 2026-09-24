import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const server = readFileSync('src/server.ts', 'utf8');

test('Human Gate never turns the AI-turn limit into HOT', () => {
  assert.match(server, /const forceHuman = !humanGate && turn >= GLOBAL_MAX_AI_TURNS/);

  const gateStart = server.indexOf('if (humanGate) {');
  assert.ok(gateStart >= 0, 'human gate block missing');

  const normalHotStart = server.indexOf('if (result.hot || forceHuman) {', gateStart);
  assert.ok(normalHotStart > gateStart, 'non-Human-Gate HOT block missing');

  const gateBlock = server.slice(gateStart, normalHotStart);
  assert.match(gateBlock, /hot: Boolean\(result\.hot\)/);
  assert.match(gateBlock, /score: result\.score/);
  assert.doesNotMatch(gateBlock, /forceHuman/);
  assert.doesNotMatch(gateBlock, /Math\.max\(result\.score, 0\.75\)/);
});
