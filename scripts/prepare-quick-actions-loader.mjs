import { readFileSync, writeFileSync } from 'node:fs';

const path = 'scripts/prepare-quick-actions.mjs';
let source = readFileSync(path, 'utf8');

const brokenPreview = 'last_message_preview: `🎙 \\${text}`.slice(0, 180)';
const fixedPreview = "last_message_preview: ('🎙 ' + text).slice(0, 180)";
if (source.includes(brokenPreview)) source = source.replace(brokenPreview, fixedPreview);
else if (!source.includes(fixedPreview)) throw new Error('prepare-quick-actions-loader: expected TTS preview source not found');

const narrowAnchor = "  'load();setInterval(()=>{if(!document.hidden)load()},2500);\\n</script>',";
const robustAnchor = "  '\\n</script>\\n</body>',";
if (source.includes(narrowAnchor)) source = source.replace(narrowAnchor, robustAnchor);
else if (!source.includes(robustAnchor)) throw new Error('prepare-quick-actions-loader: client anchor not found');

const narrowReplacement = '  `load();setInterval(()=>{if(!document.hidden)load()},2500);\n${toolboxScript}\n</script>`,';
const robustReplacement = '  `${toolboxScript}\n</script>\n</body>`,';
if (source.includes(narrowReplacement)) source = source.replace(narrowReplacement, robustReplacement);
else if (!source.includes(robustReplacement)) throw new Error('prepare-quick-actions-loader: client replacement not found');

writeFileSync(path, source);
await import('./prepare-quick-actions.mjs');
