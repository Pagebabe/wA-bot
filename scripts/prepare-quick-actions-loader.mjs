import { readFileSync, writeFileSync } from 'node:fs';

const path = 'scripts/prepare-quick-actions.mjs';
let source = readFileSync(path, 'utf8');
const broken = 'last_message_preview: `🎙 \\${text}`.slice(0, 180)';
const fixed = "last_message_preview: ('🎙 ' + text).slice(0, 180)";

if (source.includes(broken)) {
  source = source.replace(broken, fixed);
  writeFileSync(path, source);
} else if (!source.includes(fixed)) {
  throw new Error('prepare-quick-actions-loader: expected TTS preview source not found');
}

await import('./prepare-quick-actions.mjs');
