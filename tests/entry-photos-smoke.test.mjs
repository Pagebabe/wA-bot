import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const html = readFileSync('public/index.html','utf8');
const server = readFileSync('src/server.ts','utf8');
const store = readFileSync('src/store.ts','utf8');

const entryRouteStart = server.indexOf("app.post('/api/conversations/:id/send-entry-photo'");
const entryRouteEnd = server.indexOf("app.post('/api/conversations/:id/send-location'", entryRouteStart);
const entryRoute = entryRouteStart >= 0 && entryRouteEnd > entryRouteStart ? server.slice(entryRouteStart, entryRouteEnd) : '';

test('profile editor exposes dedicated door and bell photos',()=>{
  for(const id of ['pDoorPhoto','pBellPhoto','entryPhotoBtn','entryPhotoModal','entryPhotoGrid']) {
    assert.match(html,new RegExp(`id=["']${id}["']`));
  }
  assert.match(html,/Ankunftsfotos/);
  assert.match(html,/entry_photos/);
});

test('entry photo sender is human-gated and profile-scoped',()=>{
  assert.ok(entryRoute,'entry photo route missing');
  assert.match(entryRoute,/c\.state !== 'HUMAN_ACTIVE'/);
  assert.match(entryRoute,/profile\.entry_photos/);
  assert.match(entryRoute,/photos\.door_url/);
  assert.match(entryRoute,/photos\.bell_url/);
  assert.match(entryRoute,/sendImageUrl\(c\.profile_id, c\.wa_jid, url, label\)/);
  assert.doesNotMatch(entryRoute,/body\.url/);
});

test('entry photo UI keeps one compact mobile composer control',()=>{
  assert.match(html,/onclick="openEntryPhotoPicker\(\)"/);
  assert.match(html,/const options=\[\['door','Haustür'/);
  assert.match(html,/\['bell','Klingel'/);
  assert.match(html,/async function sendEntryPhoto\(type\)/);
  assert.match(html,/grid-template-columns:auto auto auto minmax\(0,1fr\) auto/);
  assert.match(store,/entry_photos\?: \{ door_url\?: string \| null; bell_url\?: string \| null \}/);
});
