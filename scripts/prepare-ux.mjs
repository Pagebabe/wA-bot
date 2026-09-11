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
  '<button class="icon" title="Schließen" aria-label="Chat schließen" onclick="closeConversation()">✕</button>',
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
  '<div class="settingsGroup"><h3>HOT-Benachrichtigungen</h3><div class="notice" id="pushStatus">Browser-Benachrichtigungen noch nicht aktiviert.</div><button class="btn" id="pushBtn" onclick="activatePush()" style="margin-top:10px">🔔 HOT-Handyalarm aktivieren</button></div><div class="settingsGroup"><h3>KI-Testlabor</h3><div class="notice">Testet das echte konfigurierte Modell ohne WhatsApp-Nachricht zu senden.</div><div class="field" style="margin-top:10px"><label>Profil</label><select id="sTestProfile"></select></div><div class="field" style="margin-top:10px"><label>Testnachricht des Leads</label><textarea id="sTestMessage" placeholder="z. B. Hallo, ich möchte heute um 20 Uhr einen Termin."></textarea></div><div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin-top:10px"><button class="btn" id="playgroundBtn" onclick="runPlayground()">🧪 KI testen</button><button class="btn" onclick="seedHot()">🔥 Demo-HOT erzeugen</button></div><div id="playgroundResult" class="notice" style="display:none;margin-top:10px;white-space:pre-wrap"></div></div>',
  'push and playground settings',
);

const oldOpenSettings = "function openSettings(){const s=state.settings;$('sBase').value=s.llm_base_url||'https://api.openai.com';$('sModel').value=s.llm_model||'gpt-5-mini';$('sKey').value='';$('sDisclosure').checked=s.ai_disclosure_enabled!==false;$('sVoiceEnabled').checked=!!s.voice_enabled;$('sVoiceProvider').value=s.voice_provider||'same-api';$('sVoiceModel').value=s.voice_model||'gpt-4o-mini-tts';$('testResult').textContent=s.has_llm_key?'Schlüssel gespeichert':'';$('settingsModal').classList.add('open')}";
const newOpenSettings = "function openSettings(){const s=state.settings;$('sBase').value=s.llm_base_url||'https://api.openai.com';$('sModel').value=s.llm_model||'gpt-5-mini';$('sKey').value='';const envKey=s.llm_key_source==='environment';$('sKey').disabled=envKey;$('sKey').placeholder=envKey?'Railway-Secret aktiv':'gespeichert oder neu eintragen';$('sDisclosure').checked=s.ai_disclosure_enabled!==false;$('sVoiceEnabled').checked=!!s.voice_enabled;$('sVoiceProvider').value=s.voice_provider||'same-api';$('sVoiceModel').value=s.voice_model||'gpt-4o-mini-tts';$('testResult').textContent=s.has_llm_key?(envKey?'✅ Railway-Secret aktiv':'Schlüssel gespeichert'):'';if($('pushStatus'))$('pushStatus').textContent=('Notification'in window&&Notification.permission==='granted')?'✅ Browser-Benachrichtigungen erlaubt':('Notification'in window&&Notification.permission==='denied')?'❌ Browser-Benachrichtigungen blockiert':'Browser-Benachrichtigungen noch nicht aktiviert.';if($('sTestProfile')){$('sTestProfile').innerHTML=state.profiles.map(p=>'<option value=\"'+esc(p.id)+'\">'+esc(p.name)+'</option>').join('');if(state.selectedProfile)$('sTestProfile').value=state.selectedProfile}if($('playgroundResult')){$('playgroundResult').style.display='none';$('playgroundResult').textContent=''};$('settingsModal').classList.add('open')}";
html = replaceOnce(html, oldOpenSettings, newOpenSettings, 'LLM key source and playground UX');

const oldTail = "async function seedHot(){try{await api('/api/demo/hot',{method:'POST',body:'{}'});await load();toast('Demo-HOT-Lead erstellt');closeModal('settingsModal');setFilter('hot')}catch(e){toast(e.message)}}\n$('composer').addEventListener('keydown',e=>{if(e.key==='Enter'&&!e.shiftKey){e.preventDefault();sendMessage()}});";
const newTail = "async function seedHot(){try{await api('/api/demo/hot',{method:'POST',body:'{}'});await load();toast('Demo-HOT-Lead erstellt');closeModal('settingsModal');setFilter('hot')}catch(e){toast(e.message)}}\nasync function runPlayground(){const profile_id=$('sTestProfile').value;const text=$('sTestMessage').value.trim();const out=$('playgroundResult');if(!profile_id||!text){out.style.display='block';out.textContent='Profil und Testnachricht eingeben.';return}out.style.display='block';out.textContent='Teste echte KI …';try{const r=await api('/api/test/qualify',{method:'POST',body:JSON.stringify({profile_id,text})});out.textContent=(r.hot?'🔥 HOT':'🤖 KI AKTIV')+' · Score '+Math.round(Number(r.score||0)*100)+'%\\n'+(r.reason?'Grund: '+r.reason+'\\n':'')+'Antwort: '+(r.reply||'(keine Antwort – Übergabe)')}catch(e){out.textContent='❌ '+e.message}}\nfunction pushKeyBytes(key){const pad='='.repeat((4-key.length%4)%4);const raw=atob((key+pad).replace(/-/g,'+').replace(/_/g,'/'));return Uint8Array.from([...raw].map(c=>c.charCodeAt(0)))}\nasync function activatePush(){const status=$('pushStatus');if(!('serviceWorker'in navigator)||!('PushManager'in window)||!('Notification'in window)){if(status)status.textContent='❌ Dieser Browser unterstützt Push nicht.';return}try{const permission=await Notification.requestPermission();if(permission!=='granted'){if(status)status.textContent=permission==='denied'?'❌ Benachrichtigungen im Browser blockiert':'Benachrichtigungen nicht erlaubt.';return}const reg=await navigator.serviceWorker.register('/sw.js');await navigator.serviceWorker.ready;const key=await api('/api/push/key');let sub=await reg.pushManager.getSubscription();if(!sub)sub=await reg.pushManager.subscribe({userVisibleOnly:true,applicationServerKey:pushKeyBytes(key.publicKey)});await api('/api/push/subscribe',{method:'POST',body:JSON.stringify({subscription:sub.toJSON?sub.toJSON():sub})});if(status)status.textContent='✅ HOT-Benachrichtigungen aktiv';toast('HOT-Benachrichtigungen aktiviert')}catch(e){if(status)status.textContent='❌ '+e.message;toast('Push konnte nicht aktiviert werden')}}\n$('composer').addEventListener('keydown',e=>{if(e.key==='Enter'&&!e.shiftKey){e.preventDefault();sendMessage()}});";
html = replaceOnce(html, oldTail, newTail, 'playground and push activation code');

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
server = replaceOnce(
  server,
  "  const profile = await getProfile(profileId);\n  const existing = (await conversations(profileId)).find((x) => x.wa_jid === jid);\n  const now = new Date().toISOString();",
  "  const profile = await getProfile(profileId);\n  const existing = (await conversations(profileId)).find((x) => x.wa_jid === jid);\n  if (existing && waMessageId) {\n    const duplicate = (await messages(existing.id)).some((m) => m.wa_message_id === waMessageId);\n    if (duplicate) {\n      app.log.info({ profileId, conversationId: existing.id, waMessageId }, 'Duplicate WhatsApp message ignored');\n      return;\n    }\n  }\n  const now = new Date().toISOString();",
  'inbound WhatsApp idempotency before counters and AI',
);
server = replaceOnce(
  server,
  "    const result = await qualifyLead(currentSettings as LlmSettings, profile, conversation, allMessages);\n    const turn = Number(conversation.ai_turns || 0) + 1;",
  "    const result = await qualifyLead(currentSettings as LlmSettings, profile, conversation, allMessages);\n    const latestConversation = (await conversations(profileId)).find((x) => x.id === conversation.id);\n    if (!latestConversation || latestConversation.state !== 'AI_ACTIVE') {\n      app.log.info({ profileId, conversationId: conversation.id, state: latestConversation?.state }, 'AI result discarded after ownership/state changed');\n      return;\n    }\n    conversation = latestConversation;\n    const turn = Number(conversation.ai_turns || 0) + 1;",
  'AI ownership recheck after model latency',
);
server = replaceOnce(
  server,
  "app.post('/api/conversations/:id/takeover', async (request) => {\n  return updateConversation((request.params as any).id, { state: 'HUMAN_ACTIVE', unread_count: 0 });\n});\n\napp.post('/api/conversations/:id/return-ai', async (request) => {\n  return updateConversation((request.params as any).id, { state: 'AI_ACTIVE', unread_count: 0, hot_reason: null, hot_score: null });\n});\n\napp.post('/api/conversations/:id/close', async (request) => updateConversation((request.params as any).id, { state: 'CLOSED', unread_count: 0 }));",
  "app.post('/api/conversations/:id/takeover', async (request, reply) => {\n  const id = (request.params as any).id;\n  const current = (await conversations()).find((x) => x.id === id);\n  if (!current) return reply.code(404).send({ error: 'Chat nicht gefunden' });\n  const updated = await updateConversation(id, { state: 'HUMAN_ACTIVE', unread_count: 0 });\n  await gateway('add_event', { data: { profile_id: current.profile_id, conversation_id: id, type: 'HUMAN_TAKEOVER', payload: {} } });\n  return updated;\n});\n\napp.post('/api/conversations/:id/return-ai', async (request, reply) => {\n  const id = (request.params as any).id;\n  const current = (await conversations()).find((x) => x.id === id);\n  if (!current) return reply.code(404).send({ error: 'Chat nicht gefunden' });\n  const updated = await updateConversation(id, { state: 'AI_ACTIVE', unread_count: 0, hot_reason: null, hot_score: null });\n  await gateway('add_event', { data: { profile_id: current.profile_id, conversation_id: id, type: 'RETURN_TO_AI', payload: {} } });\n  return updated;\n});\n\napp.post('/api/conversations/:id/close', async (request, reply) => {\n  const id = (request.params as any).id;\n  const current = (await conversations()).find((x) => x.id === id);\n  if (!current) return reply.code(404).send({ error: 'Chat nicht gefunden' });\n  const updated = await updateConversation(id, { state: 'CLOSED', unread_count: 0 });\n  await gateway('add_event', { data: { profile_id: current.profile_id, conversation_id: id, type: 'CLOSED', payload: {} } });\n  return updated;\n});",
  'state transition audit events',
);
server = replaceOnce(
  server,
  "app.post('/api/demo/hot', async () => {",
  "app.post('/api/test/qualify', async (request, reply) => {\n  const body: any = request.body || {};\n  const profileId = String(body.profile_id || '').trim();\n  const text = String(body.text || '').trim();\n  if (!profileId || !text) return reply.code(400).send({ error: 'Profil und Testnachricht fehlen' });\n  if (text.length > 4000) return reply.code(400).send({ error: 'Testnachricht ist zu lang' });\n  const profile = await getProfile(profileId);\n  const now = new Date().toISOString();\n  const testConversation = {\n    id: 'playground', profile_id: profile.id, wa_jid: 'playground@s.whatsapp.net', contact_name: 'Test Lead',\n    state: 'AI_ACTIVE', hot_score: null, hot_reason: null, ai_turns: 0, unread_count: 0,\n    last_message_preview: text.slice(0, 180), last_message_at: now,\n  } as unknown as Conversation;\n  const testMessages = [{\n    id: 'playground-message', conversation_id: 'playground', direction: 'in', sender: 'lead', kind: 'text', text, created_at: now,\n  }] as unknown as StoredMessage[];\n  try {\n    const result = await qualifyLead(await settings() as LlmSettings, profile, testConversation, testMessages);\n    return { ok: true, ...result };\n  } catch (error) {\n    app.log.warn({ err: error }, 'Playground qualification failed');\n    return reply.code(502).send({ error: error instanceof Error ? error.message.slice(0, 300) : 'KI-Test fehlgeschlagen' });\n  }\n});\n\napp.post('/api/demo/hot', async () => {",
  'safe qualification playground route',
);
writeFileSync(serverPath, server);

console.log('prepare-ux: clickability, settings semantics, idempotency, race guards, audit trail, playground, push and close affordance hardened');
