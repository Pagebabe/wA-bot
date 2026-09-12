import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const html = readFileSync('public/index.html','utf8');
const server = readFileSync('src/server.ts','utf8');
const store = readFileSync('src/store.ts','utf8');

test('profile editor exposes dedicated door and bell photos',()=>{
  for(const id of ['pDoorPhoto','pBellPhoto','entryPhotoBtn','entryPhotoModal','entryPhotoGrid']) {
    assert.match(html,new RegExp(`id=["']${id}["']`));
  }
  assert.match(html,/Ankunftsfotos/);
  assert.match(html,/entry_photos/);
});

test('entry photo sender is human-gated and profile-scoped',()=>{
  assert.match(server,/\/api\/conversations\/:id\/send-entry-photo/);
  assert.match(server,/c\.state !== 'HUMAN_ACTIVE'/);
  assert.match(server,/profile\.entry_photos/);
  assert.match(server,/photos\.door_url/);
  assert.match(server,/photos\.bell_url/);
  assert.match(server,/sendImageUrl\(c\.profile_id, c\.wa_jid, url, label\)/);
  assert.doesNotMatch(server,/body\.url/);
});

test('entry photo UI keeps one compact mobile composer control',()=>{
  assert.match(html,/onclick="openEntryPhotoPicker\(\)"/);
  assert.match(html,/sendEntryPhoto\('door'\)/);
  assert.match(html,/sendEntryPhoto\('bell'\)/);
  assert.match(html,/grid-template-columns:auto auto auto minmax\(0,1fr\) auto/);
  assert.match(store,/entry_photos\?: \{ door_url\?: string \| null; bell_url\?: string \| null \}/);
});
