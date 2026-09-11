import { readFileSync, writeFileSync } from 'node:fs';

const path = 'tests/browser-ui-smoke.test.mjs';
let source = readFileSync(path, 'utf8');
const before = "    json(res,404,{error:'not_found'});";
const after = "    if (path === '/favicon.ico' || path === '/.well-known/appspecific/com.chrome.devtools.json') { res.writeHead(204); return res.end(); }\n    json(res,404,{error:'not_found'});";
if (!source.includes(after)) {
  if (!source.includes(before)) throw new Error('prepare-tests: fallback pattern missing');
  source = source.replace(before, after);
  writeFileSync(path, source);
}
console.log('prepare-tests: Chromium auxiliary paths normalized');
