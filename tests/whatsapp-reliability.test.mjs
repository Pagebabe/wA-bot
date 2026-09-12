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
