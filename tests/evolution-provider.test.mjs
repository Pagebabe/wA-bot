import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const provider = readFileSync('src/whatsapp-provider.ts', 'utf8');
const server = readFileSync('src/server.ts', 'utf8');
const env = readFileSync('.env.example', 'utf8');

test('WhatsApp provider defaults safely to direct Baileys', () => {
  assert.match(provider, /WHATSAPP_PROVIDER \|\| 'baileys'/);
  assert.match(env, /WHATSAPP_PROVIDER=baileys/);
});

test('Evolution adapter supports instance lifecycle and current outbound features', () => {
  assert.match(provider, /\/instance\/create/);
  assert.match(provider, /\/instance\/connectionState\//);
  assert.match(provider, /\/instance\/connect\//);
  assert.match(provider, /\/instance\/logout\//);
  assert.match(provider, /\/message\/sendText\//);
  assert.match(provider, /\/message\/sendMedia\//);
  assert.match(provider, /\/message\/sendLocation\//);
  assert.match(provider, /\/message\/sendWhatsAppAudio\//);
});

test('Evolution inbound webhook is authenticated and normalized', () => {
  assert.match(provider, /timingSafeEqual/);
  assert.match(provider, /x-wa-bot-secret/);
  assert.match(provider, /messages\.upsert/);
  assert.match(provider, /connection\.update/);
  assert.match(provider, /qrcode\.updated/);
  assert.match(provider, /inboundHandler\(profileId, jid/);
  assert.match(server, /app\.post\('\/api\/evolution\/webhook'/);
  assert.match(server, /isEvolutionWebhookAuthorized/);
});

test('Evolution webhook config is reconciled to survive provider restarts', () => {
  assert.match(provider, /\/webhook\/find\//);
  assert.match(provider, /\/webhook\/set\//);
  assert.match(provider, /startEvolutionWebhookWatchdog/);
  assert.match(provider, /5 \* 60_000/);
});

test('server imports WhatsApp through provider abstraction after build transform', () => {
  assert.match(server, /from '\.\/whatsapp-provider\.js'/);
  assert.doesNotMatch(server, /from '\.\/whatsapp\.js'/);
  assert.match(server, /whatsappProvider: whatsappProviderName\(\)/);
});
