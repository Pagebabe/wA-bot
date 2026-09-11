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
  '<button class="icon" title="Schließen" onclick="closeConversation()">⋮</button>',
  '<button class="icon" title="Chat schließen" aria-label="Chat schließen" onclick="closeConversation()">✕</button>',
  'explicit chat close control',
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

html = replaceOnce(
  html,
  '<div class="settingsGroup"><h3>Test</h3><button class="btn" onclick="seedHot()">🔥 Demo-HOT-Lead erzeugen</button></div>',
  '<div class="settingsGroup"><h3>HOT-Benachrichtigungen</h3><div class="notice" id="pushStatus">Browser-Benachrichtigungen noch nicht aktiviert.</div><button class="btn" id="pushBtn" onclick="activatePush()" style="margin-top:10px">🔔 HOT-Handyalarm aktivieren</button></div><div class="settingsGroup"><h3>Test</h3><button class="btn" onclick="seedHot()">🔥 Demo-HOT-Lead erzeugen</button></div>',
  'push activation settings',
);

const oldOpenSettings = "function openSettings(){const s=state.settings;$('sBase').value=s.llm_base_url||'https://api.openai.com';$('sModel').value=s.llm_model||'gpt-5-mini';$('sKey').value='';$('sDisclosure').checked=s.ai_disclosure_enabled!==false;$('sVoiceEnabled').checked=!!s.voice_enabled;$('sVoiceProvider').value=s.voice_provider||'same-api';$('sVoiceModel').value=s.voice_model||'gpt-4o-mini-tts';$('testResult').textContent=s.has_llm_key?'Schlüssel gespeichert':'';$('settingsModal').classList.add('open')}";
const newOpenSettings = "function openSettings(){const s=state.settings;$('sBase').value=s.llm_base_url||'https://api.openai.com';$('sModel').value=s.llm_model||'gpt-5-mini';$('sKey').value='';const envKey=s.llm_key_source==='environment';$('sKey').disabled=envKey;$('sKey').placeholder=envKey?'Railway-Secret aktiv':'gespeichert oder neu eintragen';$('sDisclosure').checked=s.ai_disclosure_enabled!==false;$('sVoiceEnabled').checked=!!s.voice_enabled;$('sVoiceProvider').value=s.voice_provider||'same-api';$('sVoiceModel').value=s.voice_model||'gpt-4o-mini-tts';$('testResult').textContent=s.has_llm_key?(envKey?'✅ Railway-Secret aktiv':'Schlüssel gespeichert'):'';if($('pushStatus'))$('pushStatus').textContent=('Notification'in window&&Notification.permission==='granted')?'✅ Browser-Benachrichtigungen erlaubt':('Notification'in window&&Notification.permission==='denied')?'❌ Browser-Benachrichtigungen blockiert':'Browser-Benachrichtigungen noch nicht aktiviert.';$('settingsModal').classList.add('open')}";
html = replaceOnce(html, oldOpenSettings, newOpenSettings, 'LLM key source UX');

const oldTail = "async function seedHot(){try{await api('/api/demo/hot',{method:'POST',body:'{}'});await load();toast('Demo-HOT-Lead erstellt');closeModal('settingsModal');setFilter('hot')}catch(e){toast(e.message)}}\n$('composer').addEventListener('keydown',e=>{if(e.key==='Enter'&&!e.shiftKey){e.preventDefault();sendMessage()}});";
const newTail = "async function seedHot(){try{await api('/api/demo/hot',{method:'POST',body:'{}'});await load();toast('Demo-HOT-Lead erstellt');closeModal('settingsModal');setFilter('hot')}catch(e){toast(e.message)}}\nfunction pushKeyBytes(key){const pad='='.repeat((4-key.length%4)%4);const raw=atob((key+pad).replace(/-/g,'+').replace(/_/g,'/'));return Uint8Array.from([...raw].map(c=>c.charCodeAt(0)))}\nasync function activatePush(){const status=$('pushStatus');if(!('serviceWorker'in navigator)||!('PushManager'in window)||!('Notification'in window)){if(status)status.textContent='❌ Dieser Browser unterstützt Push nicht.';return}try{const permission=await Notification.requestPermission();if(permission!=='granted'){if(status)status.textContent=permission==='denied'?'❌ Benachrichtigungen im Browser blockiert':'Benachrichtigungen nicht erlaubt.';return}const reg=await navigator.serviceWorker.register('/sw.js');await navigator.serviceWorker.ready;const key=await api('/api/push/key');let sub=await reg.pushManager.getSubscription();if(!sub)sub=await reg.pushManager.subscribe({userVisibleOnly:true,applicationServerKey:pushKeyBytes(key.publicKey)});await api('/api/push/subscribe',{method:'POST',body:JSON.stringify({subscription:sub.toJSON?sub.toJSON():sub})});if(status)status.textContent='✅ HOT-Benachrichtigungen aktiv';toast('HOT-Benachrichtigungen aktiviert')}catch(e){if(status)status.textContent='❌ '+e.message;toast('Push konnte nicht aktiviert werden')}}\n$('composer').addEventListener('keydown',e=>{if(e.key==='Enter'&&!e.shiftKey){e.preventDefault();sendMessage()}});";
html = replaceOnce(html, oldTail, newTail, 'push activation code');

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

console.log('prepare-ux: clickability, settings semantics, push activation and close affordance hardened');
