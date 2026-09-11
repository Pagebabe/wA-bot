import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const html = readFileSync('public/index.html', 'utf8');
const server = readFileSync('src/server.ts', 'utf8');
const store = readFileSync('src/store.ts', 'utf8');
const ai = readFileSync('src/ai.ts', 'utf8');
const wa = readFileSync('src/whatsapp.ts', 'utf8');

test('profile contains identity, desired location and per-profile assets', () => {
  for (const id of ['pName','pAvatar','pPhone','pLocation','pDesiredLocation','pPrice','pHours','pQuick','pMedia']) {
    assert.match(html, new RegExp(`id=["']${id}["']`), `missing profile field ${id}`);
  }
  assert.match(html, /Wunschstandort \/ Einsatzgebiet/);
  assert.match(html, /Schnellantworten/);
  assert.match(html, /Bilder zum Senden/);
});

test('profile values round-trip through UI and API model', () => {
  assert.match(html, /desired_location:\$\('pDesiredLocation'\)\.value\.trim\(\)/);
  assert.match(html, /quick_replies:\$\('pQuick'\)/);
  assert.match(html, /avatar_url:\$\('pAvatar'\)/);
  assert.match(server, /'desired_location'/);
  assert.match(server, /desired_location: body\.desired_location/);
  assert.match(store, /desired_location\?: string \| null/);
  assert.match(ai, /Wunschstandort \/ Einsatzgebiet/);
});

test('per-profile quick replies and image sending are shipped and ownership-gated', () => {
  assert.match(html, /id="quickBar"/);
  assert.match(html, /id="mediaBtn"/);
  assert.match(html, /function sendQuickReply/);
  assert.match(html, /function sendProfileMedia/);
  assert.match(server, /\/api\/conversations\/:id\/send-media/);
  assert.match(server, /c\.state !== 'HUMAN_ACTIVE'/);
  assert.match(server, /allowed\.includes\(url\)/);
  assert.match(wa, /export async function sendImageUrl/);
});

test('image messages render as images in chat', () => {
  assert.match(html, /m\.kind==='image'&&m\.media_url/);
  assert.match(html, /Gesendetes Bild/);
});
