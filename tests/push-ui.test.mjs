import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const html = readFileSync('public/index.html','utf8');
const sw = readFileSync('public/sw.js','utf8');
const server = readFileSync('src/server.ts','utf8');

test('HOT push activation is visible and wired end to end', () => {
  assert.match(html, /id="pushBtn"/);
  assert.match(html, /onclick="activatePush\(\)"/);
  assert.match(html, /navigator\.serviceWorker\.register\('\/sw\.js'\)/);
  assert.match(html, /api\('\/api\/push\/key'\)/);
  assert.match(html, /api\('\/api\/push\/subscribe'/);
  assert.match(server, /app\.get\('\/api\/push\/key'/);
  assert.match(server, /app\.post\('\/api\/push\/subscribe'/);
});

test('service worker displays and opens HOT notifications', () => {
  assert.match(sw, /addEventListener\('push'/);
  assert.match(sw, /showNotification/);
  assert.match(sw, /requireInteraction: true/);
  assert.match(sw, /addEventListener\('notificationclick'/);
  assert.match(sw, /clients\.openWindow/);
});
