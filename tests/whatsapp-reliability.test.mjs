import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const wa = readFileSync('src/whatsapp.ts', 'utf8');

test('WhatsApp auth writes are serialized per profile', () => {
  assert.match(wa, /const authWriteQueues = new Map<string, Promise<void>>\(\)/);
  assert.match(wa, /const previous = authWriteQueues\.get\(profileId\) \|\| Promise\.resolve\(\)/);
  assert.match(wa, /authWriteQueues\.set\(profileId, current\)/);
});

test('restart-required disconnect reconnects quickly without presenting as hard error', () => {
  assert.match(wa, /code === DisconnectReason\.restartRequired/);
  assert.match(wa, /restartRequired \? 'connecting' : 'error'/);
  assert.match(wa, /restartRequired \? 250 : 2500/);
});

test('stalled connecting session is recycled while QR-waiting sessions are left alone', () => {
  assert.match(wa, /WA_CONNECT_TIMEOUT_MS/);
  assert.match(wa, /session\.status !== 'connecting' \|\| session\.qrDataUrl/);
  assert.match(wa, /session\.socket\?\.end\(new Error\('WhatsApp connect watchdog timeout'\)\)/);
  assert.match(wa, /sessions\.delete\(profile\.id\)/);
  assert.match(wa, /clearConnectWatch\(session\)/);
});
