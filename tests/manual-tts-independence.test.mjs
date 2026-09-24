import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const server = readFileSync('src/server.ts', 'utf8');
const ui = readFileSync('public/index.html', 'utf8');
const prepare = readFileSync('scripts/prepare-quick-actions.mjs', 'utf8');

test('manual TTS is independent from automatic voice mode', () => {
  const start = server.indexOf("app.post('/api/conversations/:id/send-tts'");
  assert.ok(start >= 0, 'send-tts route missing');
  const end = server.indexOf("app.post('/api/conversations/:id/send-voice-upload'", start);
  const block = server.slice(start, end);
  assert.match(block, /synthesizeVoice/);
  assert.match(block, /sendVoiceAudio/);
  assert.doesNotMatch(block, /currentSettings\.voice_enabled/);
});

test('settings UI clearly separates automatic voice from manual TTS', () => {
  assert.match(ui, /Automatische Voice-Verarbeitung \(STT\/AI-Voice\)/);
  assert.match(ui, /manuelles Text→Sprache ist unabhängig von der Voice-Automatik verfügbar/);
});

test('quick-actions generator cannot reintroduce the old voice_enabled TTS gate', () => {
  const start = prepare.indexOf("app.post('/api/conversations/:id/send-tts'");
  assert.ok(start >= 0, 'generated send-tts route missing');
  const end = prepare.indexOf("app.post('/api/conversations/:id/send-voice-upload'", start);
  const block = prepare.slice(start, end);
  assert.doesNotMatch(block, /currentSettings\.voice_enabled/);
  assert.match(block, /audio\.buffer, audio\.mime/);
});
