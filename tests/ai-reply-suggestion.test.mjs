import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const server = readFileSync('src/server.ts', 'utf8');
const ui = readFileSync('public/index.html', 'utf8');

test('AI reply suggestion endpoint cannot send WhatsApp messages', () => {
  const start = server.indexOf("app.post('/api/conversations/:id/suggest-reply'");
  assert.ok(start >= 0, 'suggest-reply route missing');
  const end = server.indexOf("app.post('/api/conversations/:id/send'", start);
  assert.ok(end > start, 'send route boundary missing');
  const block = server.slice(start, end);
  assert.match(block, /qualifyLead/);
  assert.match(block, /state !== 'HUMAN_ACTIVE'/);
  assert.doesNotMatch(block, /sendText\(/);
  assert.doesNotMatch(block, /sendVoiceAudio\(/);
  assert.doesNotMatch(block, /sendImageUrl\(/);
});

test('moderator UI exposes AI next-reply suggestion without auto-send', () => {
  assert.match(ui, /id="suggestBtn"/);
  assert.match(ui, /onclick="suggestReply\(\)"/);
  assert.match(ui, /async function suggestReply\(\)/);
  assert.match(ui, /\/suggest-reply/);
  assert.match(ui, /\$\("composer"\)\.value = String\(result\.reply/);
  const start = ui.indexOf('async function suggestReply()');
  const end = ui.indexOf('async function sendMessage()', start);
  const block = ui.slice(start, end);
  assert.doesNotMatch(block, /\/send"/);
});

test('Human Gate visibly distinguishes WARM from HOT', () => {
  assert.match(ui, /Human Gate · WARM prüfen/);
  assert.match(ui, /Number\(c\.pending_ai_score \|\| 0\) >= 0\.7/);
});
