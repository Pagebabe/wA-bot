import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const wa = readFileSync('src/whatsapp.ts', 'utf8');
const html = readFileSync('public/index.html', 'utf8');

test('connection state exposes linked WhatsApp account identity', () => {
  assert.match(wa, /account: \{ id: string; number: string \| null; name: string \| null \} \| null/);
  assert.match(wa, /accountFromUser\(state\.creds\?\.me\)/);
  assert.match(wa, /session\.account = accountFromUser\(socket\.user\)/);
  assert.match(wa, /account: session\.account/);
});

test('profile UI shows linked WhatsApp number and name', () => {
  assert.match(html, /function waAccountLabel\(p\)/);
  assert.match(html, /Verbundenes WhatsApp:/);
  assert.match(html, /waAccountLabel\(p\)\|\|p\.connection\?\.status/);
  assert.match(html, /waAccountLabel\(p\)\|\|p\.location\|\|p\.phone_label/);
});
