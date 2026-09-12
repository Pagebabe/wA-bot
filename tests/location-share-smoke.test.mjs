import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const html = readFileSync('public/index.html','utf8');
const server = readFileSync('src/server.ts','utf8');
const wa = readFileSync('src/whatsapp.ts','utf8');
const store = readFileSync('src/store.ts','utf8');

test('profile editor exposes a saved Wahladresse with coordinates',()=>{
  for(const id of ['pShareLabel','pShareAddress','pShareLat','pShareLng','locationBtn']) assert.match(html,new RegExp(`id=["']${id}["']`));
  assert.match(html,/Wahladresse als WhatsApp-Standort/);
  assert.match(html,/share_location/);
});

test('location sending is native WhatsApp location and profile scoped',()=>{
  assert.match(wa,/export async function sendLocation/);
  assert.match(wa,/degreesLatitude/);
  assert.match(wa,/degreesLongitude/);
  assert.match(server,/\/api\/conversations\/:id\/send-location/);
  assert.match(server,/c\.state !== 'HUMAN_ACTIVE'/);
  assert.match(server,/profile\.share_location/);
  assert.match(server,/sendLocation\(c\.profile_id, c\.wa_jid/);
  assert.doesNotMatch(server,/body\.latitude/);
  assert.doesNotMatch(server,/body\.longitude/);
});

test('location messages are persisted as a first-class message kind',()=>{
  assert.match(store,/kind: 'text' \| 'voice' \| 'image' \| 'location' \| 'system'/);
  assert.match(server,/kind: 'location'/);
  assert.match(server,/last_message_preview: `📍/);
});
