import { readFileSync, writeFileSync } from 'node:fs';

const path = 'public/index.html';
let html = readFileSync(path, 'utf8');

const replacements = [
  ['onclick="openMediaPicker()" disabled>🖼', 'onclick="openMediaPicker()">🖼'],
  ['onclick="sendProfileLocation()" disabled>📍', 'onclick="sendProfileLocation()">📍'],
  ['onclick="openEntryPhotoPicker()" disabled>🏠', 'onclick="openEntryPhotoPicker()">🏠'],
  ['onclick="sendMessage()" disabled>➤', 'onclick="sendMessage()">➤'],
  ["document.querySelector('.sendBtn').disabled=!canWrite;", "document.querySelector('.sendBtn').disabled=false;"],
  ["$('mediaBtn').disabled=!canWrite;$('locationBtn').disabled=!canWrite;$('entryPhotoBtn').disabled=!canWrite;renderQuickBar()", "$('mediaBtn').disabled=false;$('locationBtn').disabled=false;$('entryPhotoBtn').disabled=false;renderQuickBar()"],
];

for (const [before, after] of replacements) {
  if (html.includes(after)) continue;
  if (!html.includes(before)) throw new Error(`prepare-composer-actions: pattern missing: ${before.slice(0, 60)}`);
  html = html.replace(before, after);
}

writeFileSync(path, html);
console.log('prepare-composer-actions: footer buttons stay clickable and explain takeover requirement');
