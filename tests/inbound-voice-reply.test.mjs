import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const prepare = readFileSync('scripts/prepare-inbound-voice-reply.mjs', 'utf8');
const pkg = JSON.parse(readFileSync('package.json', 'utf8'));

test('build and dev apply inbound voice-note reply routing', () => {
  for (const key of ['dev', 'build', 'typecheck']) {
    assert.match(pkg.scripts[key], /prepare-inbound-voice-reply\.mjs/);
  }
});

test('only inbound voice notes may trigger AI TTS and failures fall back to text', () => {
  assert.match(prepare, /kind === 'voice' && currentSettings\.voice_enabled/);
  assert.match(prepare, /synthesizeVoice\(currentSettings as LlmSettings, outgoingText, 'alloy'\)/);
  assert.match(prepare, /sendVoiceAudio\(profileId, jid, audio\.buffer, audio\.mime\)/);
  assert.match(prepare, /AI voice reply failed, falling back to text/);
  assert.match(prepare, /sentId = await sendText\(profileId, jid, outgoingText\)/);
  assert.match(prepare, /kind: outgoingKind/);
});
