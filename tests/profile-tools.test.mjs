import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const html = readFileSync('public/index.html', 'utf8');
const server = readFileSync('src/server.ts', 'utf8');
const whatsapp = readFileSync('src/whatsapp.ts', 'utf8');
const store = readFileSync('src/store.ts', 'utf8');

test('profile editor exposes avatar quick replies and media', () => {
  for (const id of ['pAvatar', 'pQuick', 'pMedia', 'mediaBtn', 'mediaModal', 'quickBar']) {
    assert.match(html, new RegExp(`id=["']${id}["']`));
  }
});

test('profile quick replies and media are wired to human chat controls', () => {
  assert.match(html, /function renderQuickBar\(/);
  assert.match(html, /function sendQuickReply\(/);
  assert.match(html, /function openMediaPicker\(/);
  assert.match(html, /function sendProfileMedia\(/);
  assert.match(html, /\/send-media/);
});

test('profile payload persists avatar and media while replies remain central', () => {
  assert.match(html, /avatar_url:/);
  assert.match(html, /state\.savedReplies/);
  assert.doesNotMatch(html, /quick_replies:\s*\$\("pQuick"\)/);
  assert.match(html, /media:/);
  assert.match(store, /quick_replies\?: string\[\]/);
});

test('backend media route is ownership gated and profile scoped', () => {
  assert.match(server, /app\.post\('\/api\/conversations\/:id\/send-media'/);
  assert.match(server, /c\.state !== 'HUMAN_ACTIVE'/);
  assert.match(server, /allowed\.includes\(url\)/);
  assert.match(server, /sendImageUrl\(/);
});

test('WhatsApp image sending only accepts HTTPS URLs', () => {
  assert.match(whatsapp, /export async function sendImageUrl/);
  assert.match(whatsapp, /parsed\.protocol !== 'https:'/);
});
