import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const html = readFileSync('public/index.html', 'utf8');

test('footer action controls remain clickable', () => {
  assert.match(html, /id="mediaBtn"[^>]*onclick="openMediaPicker\(\)"(?![^>]*disabled)/);
  assert.match(html, /id="locationBtn"[^>]*onclick="sendProfileLocation\(\)"(?![^>]*disabled)/);
  assert.match(html, /id="entryPhotoBtn"[^>]*onclick="openEntryPhotoPicker\(\)"(?![^>]*disabled)/);
  assert.match(html, /class="sendBtn"[^>]*onclick="sendMessage\(\)"(?![^>]*disabled)/);
  assert.match(html, /document\.querySelector\('\.sendBtn'\)\.disabled=false/);
  assert.match(html, /\$\('mediaBtn'\)\.disabled=false;\$\('locationBtn'\)\.disabled=false;\$\('entryPhotoBtn'\)\.disabled=false/);
});

test('footer actions explain the takeover gate instead of failing silently', () => {
  assert.match(html, /function openMediaPicker\(\).*Chat zuerst übernehmen/);
  assert.match(html, /function openEntryPhotoPicker\(\).*Chat zuerst übernehmen/);
  assert.match(html, /async function sendProfileLocation\(\).*Chat zuerst übernehmen/);
  assert.match(html, /async function sendMessage\(\).*Chat zuerst übernehmen/);
});
