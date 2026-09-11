import { readFileSync, writeFileSync } from 'node:fs';

const path = 'public/index.html';
let html = readFileSync(path, 'utf8');

const before = 'z-index:80;display:none;box-shadow:var(--shadow)';
const after = 'z-index:80;display:none;pointer-events:none;box-shadow:var(--shadow)';
if (!html.includes(after)) {
  if (!html.includes(before)) throw new Error('prepare-ux: HOT toast CSS pattern missing');
  html = html.replace(before, after);
}

writeFileSync(path, html);
console.log('prepare-ux: click-through HOT banner applied');
