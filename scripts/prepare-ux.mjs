import { readFileSync, writeFileSync } from 'node:fs';

function replaceOnce(source, before, after, label) {
  if (source.includes(after)) return source;
  if (!source.includes(before)) throw new Error(`prepare-ux: pattern missing: ${label}`);
  return source.replace(before, after);
}

const htmlPath = 'public/index.html';
let html = readFileSync(htmlPath, 'utf8');

html = replaceOnce(
  html,
  'z-index:80;display:none;box-shadow:var(--shadow)',
  'z-index:80;display:none;pointer-events:none;box-shadow:var(--shadow)',
  'HOT toast click-through',
);

html = replaceOnce(
  html,
  '<select id="pHandoff"><option value="stop">KI stoppt</option><option value="assist">KI assistiert</option><option value="continue">KI darf weiter</option></select>',
  '<select id="pHandoff" disabled><option value="stop">KI stoppt (Beta)</option></select>',
  'handoff options reflect beta behavior',
);

html = replaceOnce(
  html,
  '<input id="sVoiceProvider" value="same-api">',
  '<input id="sVoiceProvider" value="same-api" disabled title="In der Beta ist der Sprach-Anbieter an dieselbe API gebunden">',
  'voice provider beta boundary',
);

const oldOpenSettings = "function openSettings(){const s=state.settings;$('sBase').value=s.llm_base_url||'https://api.openai.com';$('sModel').value=s.llm_model||'gpt-5-mini';$('sKey').value='';$('sDisclosure').checked=s.ai_disclosure_enabled!==false;$('sVoiceEnabled').checked=!!s.voice_enabled;$('sVoiceProvider').value=s.voice_provider||'same-api';$('sVoiceModel').value=s.voice_model||'gpt-4o-mini-tts';$('testResult').textContent=s.has_llm_key?'Schlüssel gespeichert':'';$('settingsModal').classList.add('open')}";
const newOpenSettings = "function openSettings(){const s=state.settings;$('sBase').value=s.llm_base_url||'https://api.openai.com';$('sModel').value=s.llm_model||'gpt-5-mini';$('sKey').value='';const envKey=s.llm_key_source==='environment';$('sKey').disabled=envKey;$('sKey').placeholder=envKey?'Railway-Secret aktiv':'gespeichert oder neu eintragen';$('sDisclosure').checked=s.ai_disclosure_enabled!==false;$('sVoiceEnabled').checked=!!s.voice_enabled;$('sVoiceProvider').value=s.voice_provider||'same-api';$('sVoiceModel').value=s.voice_model||'gpt-4o-mini-tts';$('testResult').textContent=s.has_llm_key?(envKey?'✅ Railway-Secret aktiv':'Schlüssel gespeichert'):'';$('settingsModal').classList.add('open')}";
html = replaceOnce(html, oldOpenSettings, newOpenSettings, 'LLM key source UX');

writeFileSync(htmlPath, html);

const serverPath = 'src/server.ts';
let server = readFileSync(serverPath, 'utf8');
server = replaceOnce(
  server,
  'llm_base_url: process.env.LLM_BASE_URL || stored.llm_base_url,\n    llm_model: process.env.LLM_MODEL || stored.llm_model,',
  'llm_base_url: stored.llm_base_url || process.env.LLM_BASE_URL,\n    llm_model: stored.llm_model || process.env.LLM_MODEL,',
  'editable LLM base/model precedence',
);
server = replaceOnce(
  server,
  'has_llm_key: Boolean(raw?.llm_api_key_encrypted),',
  "has_llm_key: Boolean(raw?.llm_api_key_encrypted),\n    llm_key_source: process.env.LLM_API_KEY ? 'environment' : 'database',",
  'LLM key source exposure',
);
writeFileSync(serverPath, server);

console.log('prepare-ux: clickability and settings semantics hardened');
