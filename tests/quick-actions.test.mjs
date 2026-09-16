import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const html = readFileSync('public/index.html', 'utf8');
const server = readFileSync('src/server.ts', 'utf8');
const wa = readFileSync('src/whatsapp.ts', 'utf8');
const provider = readFileSync('src/whatsapp-provider.ts', 'utf8');

test('right-side quick action toolbox exposes all four operator tools', () => {
  for (const id of ['quickToolbox', 'toolReplies', 'toolPhotos', 'toolLocations', 'toolVoicePresets', 'recordButton', 'toolTtsText']) {
    assert.match(html, new RegExp(`id=["']${id}["']`));
  }
  for (const tab of ['Antworten', 'Fotos', 'GPS', 'Sprache']) assert.match(html, new RegExp(`>\\s*${tab}\\s*<`));
  assert.match(html, /MediaRecorder/);
  assert.match(html, /getUserMedia/);
  assert.match(html, /\{\{name\}\}/);
  assert.doesNotMatch(html, /\{\{profil\}\}/);
  assert.doesNotMatch(html, /\{\{ort\}\}/);
  assert.doesNotMatch(html, /\{\{preis\}\}/);
});

test('quick action sends stay on real profile-scoped WhatsApp routes', () => {
  assert.match(html, /send-media/);
  assert.match(html, /send-entry-photo/);
  assert.match(html, /send-location/);
  assert.match(html, /send-tts/);
  assert.match(html, /send-voice-upload/);
  assert.match(server, /\/api\/conversations\/:id\/send-tts/);
  assert.match(server, /\/api\/conversations\/:id\/send-voice-upload/);
  assert.match(server, /c\.state !== 'HUMAN_ACTIVE'/);
  assert.match(server, /audio\.length > 4 \* 1024 \* 1024/);
  assert.match(server, /allowedMime/);
  assert.match(server, /synthesizeVoice/);
  assert.match(server, /sendVoiceAudio\(c\.profile_id, c\.wa_jid, audio, mime\)/);
});

test('voice sender preserves validated browser mime for Baileys and keeps Evolution compatible', () => {
  assert.match(wa, /sendVoiceAudio\(profileId: string, jid: string, audio: Buffer, mime = 'audio\/mpeg'\)/);
  assert.match(wa, /mimetype: mime/);
  assert.match(provider, /sendVoiceAudio\(profileId: string, jid: string, audio: Buffer, mime = 'audio\/mpeg'\)/);
  assert.match(provider, /baileys\.sendVoiceAudio\(profileId, jid, audio, mime\)/);
});

test('photos and GPS require deliberate confirmation while reply templates only fill the draft', () => {
  assert.match(html, /confirm\(item\.label \+ " wirklich senden\?"\)/);
  assert.match(html, /confirm\(\(loc\.label \|\| p\.name \|\| "Standort"\) \+ " wirklich senden\?"\)/);
  assert.match(html, /\$\("composer"\)\.value = text/);
});
