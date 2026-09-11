import { readFileSync, writeFileSync } from 'node:fs';

function replaceOnce(source, before, after, label) {
  if (source.includes(after)) return source;
  if (!source.includes(before)) throw new Error(`prepare-build: pattern missing: ${label}`);
  return source.replace(before, after);
}

let server = readFileSync('src/server.ts', 'utf8');
server = replaceOnce(
  server,
  `await app.register(cors, { origin: true, credentials: true });`,
  `await app.register(cors, { origin: false });`,
  'same-origin CORS',
);
server = replaceOnce(
  server,
  `async function settings(): Promise<any> {\n  return (await gateway<{ data: any }>('get_settings')).data;\n}`,
  `async function settings(): Promise<any> {\n  const stored = (await gateway<{ data: any }>('get_settings')).data || {};\n  return {\n    ...stored,\n    llm_base_url: process.env.LLM_BASE_URL || stored.llm_base_url,\n    llm_model: process.env.LLM_MODEL || stored.llm_model,\n    llm_api_key_encrypted: process.env.LLM_API_KEY || stored.llm_api_key_encrypted,\n  };\n}`,
  'LLM environment fallback',
);
server = replaceOnce(
  server,
  `app.patch('/api/profiles/:id', async (request) => {\n  const id = (request.params as any).id;\n  const body: any = request.body || {};\n  return (await gateway<{ data: Profile }>('update_profile', { data: { id, ...body } })).data;\n});`,
  `app.patch('/api/profiles/:id', async (request, reply) => {\n  const id = (request.params as any).id;\n  const body: any = request.body || {};\n  const allowed = new Set([\n    'name', 'phone_label', 'location', 'price_text', 'hours_text', 'avatar_url',\n    'bot_enabled', 'system_prompt', 'qualification_prompt', 'hot_threshold',\n    'response_style', 'max_ai_turns', 'handoff_behavior', 'voice_mode',\n    'preset_name', 'llm_model_override', 'temperature', 'voice_name', 'media',\n  ]);\n  const unknown = Object.keys(body).filter((key) => !allowed.has(key));\n  if (unknown.length) return reply.code(400).send({ error: \\`Unbekannte Profilfelder: \\${unknown.join(', ')}\\` });\n  if ('name' in body && !String(body.name || '').trim()) return reply.code(400).send({ error: 'Name fehlt' });\n  if ('hot_threshold' in body && (!Number.isFinite(Number(body.hot_threshold)) || Number(body.hot_threshold) < 0 || Number(body.hot_threshold) > 1)) {\n    return reply.code(400).send({ error: 'HOT-Schwelle muss zwischen 0 und 1 liegen' });\n  }\n  if ('max_ai_turns' in body && (!Number.isInteger(Number(body.max_ai_turns)) || Number(body.max_ai_turns) < 1 || Number(body.max_ai_turns) > 50)) {\n    return reply.code(400).send({ error: 'KI-Runden müssen zwischen 1 und 50 liegen' });\n  }\n  const data: Record<string, unknown> = { id };\n  for (const key of allowed) if (key in body) data[key] = body[key];\n  return (await gateway<{ data: Profile }>('update_profile', { data })).data;\n});`,
  'profile PATCH validation',
);
server = replaceOnce(
  server,
  `  if (!c) return reply.code(404).send({ error: 'Chat nicht gefunden' });\n  const profile = await getProfile(c.profile_id);`,
  `  if (!c) return reply.code(404).send({ error: 'Chat nicht gefunden' });\n  if (c.state !== 'HUMAN_ACTIVE') return reply.code(409).send({ error: 'Chat muss zuerst übernommen werden' });\n  const profile = await getProfile(c.profile_id);`,
  'ownership guard before human send',
);
writeFileSync('src/server.ts', server);

let html = readFileSync('public/index.html', 'utf8');
html = replaceOnce(
  html,
  `.composer{min-height:62px;background:#202c33;padding:9px 11px;display:grid;grid-template-columns:auto auto minmax(0,1fr) auto;gap:7px;align-items:end}`,
  `.composer{min-height:62px;background:#202c33;padding:9px 11px;display:grid;grid-template-columns:minmax(0,1fr) auto;gap:7px;align-items:end}`,
  'composer layout',
);
html = replaceOnce(
  html,
  `.sendBtn{border:0;border-radius:50%;width:42px;height:42px;background:var(--green);color:#06271f;font-size:18px;font-weight:900}`,
  `.sendBtn{border:0;border-radius:50%;width:42px;height:42px;background:var(--green);color:#06271f;font-size:18px;font-weight:900}.sendBtn:disabled,.composer textarea:disabled{opacity:.5;cursor:not-allowed}`,
  'disabled composer styling',
);
html = replaceOnce(
  html,
  `<footer class="composer"><button class="icon" title="Anhängen">＋</button><button class="icon" title="Emoji">☺</button><textarea id="composer" rows="1" placeholder="Nachricht eingeben"></textarea><button class="sendBtn" onclick="sendMessage()">➤</button></footer>`,
  `<footer class="composer"><textarea id="composer" rows="1" placeholder="Chat zuerst übernehmen" disabled></textarea><button class="sendBtn" onclick="sendMessage()" disabled>➤</button></footer>`,
  'remove dead composer controls',
);
html = replaceOnce(
  html,
  `<div id="connectBox" class="settingsGroup"><h3>WhatsApp</h3><div id="connectStatus" class="notice">Nicht verbunden.</div><div style="display:flex;gap:8px;margin-top:10px;flex-wrap:wrap"><button class="btn primary" onclick="connectProfile()">QR koppeln</button><button class="btn" onclick="cloneProfile()">Profil kopieren</button><button class="btn danger" onclick="unlinkProfile()">Verknüpfung lösen</button></div></div>`,
  `<div class="settingsGroup"><h3>Modell & Medien (optional)</h3><div class="grid2"><div class="field"><label>Modell-Override</label><input id="pModel" placeholder="globales Modell verwenden"></div><div class="field"><label>Temperatur 0–2</label><input id="pTemp" type="number" min="0" max="2" step="0.05" value="0.35"></div><div class="field"><label>Stimme</label><input id="pVoiceName" placeholder="alloy"></div></div><div class="field" style="margin-top:10px"><label>Medien-URLs · eine pro Zeile</label><textarea id="pMedia" placeholder="https://…"></textarea></div></div>\n  <div id="connectBox" class="settingsGroup"><h3>WhatsApp</h3><div id="connectStatus" class="notice">Nicht verbunden.</div><div style="display:flex;gap:8px;margin-top:10px;flex-wrap:wrap"><button class="btn primary" onclick="connectProfile()">QR koppeln</button><button class="btn" onclick="cloneProfile()">Profil kopieren</button><button class="btn danger" onclick="unlinkProfile()">Verknüpfung lösen</button><button class="btn danger" onclick="deleteProfile()">Profil löschen</button></div></div>`,
  'advanced profile controls and delete',
);
html = replaceOnce(
  html,
  `const state={profiles:[],conversations:[],settings:{},selectedProfile:'',currentChat:null,editingProfile:null,filter:'all',alarmTimer:null};`,
  `const state={profiles:[],conversations:[],settings:{},selectedProfile:'',currentChat:null,editingProfile:null,filter:'all',alarmTimer:null,qrPollToken:0};`,
  'QR poll token',
);
html = replaceOnce(
  html,
  `function renderChatHeader(){const c=state.currentChat;if(!c)return;const p=profileBy(c.profile_id);$('chatName').textContent=c.contact_name||c.wa_jid;$('chatAvatar').textContent=initials(c.contact_name||c.wa_jid);$('chatMeta').textContent=(p?.name||'Profil')+' · '+(c.state==='HOT'?'HOT':c.state==='HUMAN_ACTIVE'?'von dir übernommen':'KI aktiv');$('takeBtn').style.display=c.state==='HOT'?'inline-block':'none';$('returnBtn').style.display=c.state==='HUMAN_ACTIVE'?'inline-block':'none';$('hotStrip').classList.toggle('show',c.state==='HOT');$('hotReason').textContent=c.hot_reason?'🔥 '+c.hot_reason:'🔥 HOT Lead wartet auf Übernahme'}`,
  `function renderChatHeader(){const c=state.currentChat;if(!c)return;const p=profileBy(c.profile_id);$('chatName').textContent=c.contact_name||c.wa_jid;$('chatAvatar').textContent=initials(c.contact_name||c.wa_jid);$('chatMeta').textContent=(p?.name||'Profil')+' · '+(c.state==='HOT'?'HOT':c.state==='HUMAN_ACTIVE'?'von dir übernommen':'KI aktiv');$('takeBtn').style.display=c.state==='HOT'?'inline-block':'none';$('returnBtn').style.display=c.state==='HUMAN_ACTIVE'?'inline-block':'none';$('hotStrip').classList.toggle('show',c.state==='HOT');$('hotReason').textContent=c.hot_reason?'🔥 '+c.hot_reason:'🔥 HOT Lead wartet auf Übernahme';const canWrite=c.state==='HUMAN_ACTIVE';$('composer').disabled=!canWrite;$('composer').placeholder=canWrite?'Nachricht eingeben':'Chat zuerst übernehmen';document.querySelector('.sendBtn').disabled=!canWrite}`,
  'composer ownership state',
);
html = replaceOnce(
  html,
  `async function sendMessage(){if(!state.currentChat)return;const t=$('composer').value.trim();if(!t)return;`,
  `async function sendMessage(){if(!state.currentChat)return;if(state.currentChat.state!=='HUMAN_ACTIVE')return toast('Chat zuerst übernehmen');const t=$('composer').value.trim();if(!t)return;`,
  'composer send guard',
);
html = replaceOnce(
  html,
  `function openProfiles(){$('profilesModal').classList.add('open');renderProfileRows()}function closeModal(id){$(id).classList.remove('open')}`,
  `function openProfiles(){$('profilesModal').classList.add('open');renderProfileRows()}function closeModal(id){if(id==='qrModal')state.qrPollToken++;$(id).classList.remove('open')}`,
  'QR modal cancellation',
);
html = replaceOnce(
  html,
  `function fillProfile(p){$('pName').value=p.name||'';$('pPhone').value=p.phone_label||'';$('pLocation').value=p.location||'';$('pPrice').value=p.price_text||'';$('pHours').value=p.hours_text||'';$('pBot').checked=p.bot_enabled!==false;$('pSystem').value=p.system_prompt||'';$('pQualify').value=p.qualification_prompt||'';$('pThreshold').value=p.hot_threshold??.8;$('pTurns').value=p.max_ai_turns??8;$('pStyle').value=p.response_style||'kurz';$('pHandoff').value=p.handoff_behavior||'stop';$('pVoice').value=p.voice_mode||'off'}`,
  `function fillProfile(p){$('pName').value=p.name||'';$('pPhone').value=p.phone_label||'';$('pLocation').value=p.location||'';$('pPrice').value=p.price_text||'';$('pHours').value=p.hours_text||'';$('pBot').checked=p.bot_enabled!==false;$('pSystem').value=p.system_prompt||'';$('pQualify').value=p.qualification_prompt||'';$('pThreshold').value=p.hot_threshold??.8;$('pTurns').value=p.max_ai_turns??8;$('pStyle').value=p.response_style||'kurz';$('pHandoff').value=p.handoff_behavior||'stop';$('pVoice').value=p.voice_mode||'off';$('pModel').value=p.llm_model_override||'';$('pTemp').value=p.temperature??.35;$('pVoiceName').value=p.voice_name||'alloy';$('pMedia').value=Array.isArray(p.media)?p.media.join('\\n'):''}`,
  'advanced profile fill',
);
html = replaceOnce(
  html,
  `function profilePayload(){return{name:$('pName').value.trim(),phone_label:$('pPhone').value.trim(),location:$('pLocation').value.trim(),price_text:$('pPrice').value.trim(),hours_text:$('pHours').value.trim(),bot_enabled:$('pBot').checked,system_prompt:$('pSystem').value.trim(),qualification_prompt:$('pQualify').value.trim(),hot_threshold:Number($('pThreshold').value),max_ai_turns:Number($('pTurns').value),response_style:$('pStyle').value,handoff_behavior:$('pHandoff').value,voice_mode:$('pVoice').value}}`,
  `function profilePayload(){return{name:$('pName').value.trim(),phone_label:$('pPhone').value.trim(),location:$('pLocation').value.trim(),price_text:$('pPrice').value.trim(),hours_text:$('pHours').value.trim(),bot_enabled:$('pBot').checked,system_prompt:$('pSystem').value.trim(),qualification_prompt:$('pQualify').value.trim(),hot_threshold:Number($('pThreshold').value),max_ai_turns:Number($('pTurns').value),response_style:$('pStyle').value,handoff_behavior:$('pHandoff').value,voice_mode:$('pVoice').value,llm_model_override:$('pModel').value.trim()||null,temperature:Number($('pTemp').value),voice_name:$('pVoiceName').value.trim()||'alloy',media:$('pMedia').value.split(/\\n+/).map(x=>x.trim()).filter(Boolean)}}`,
  'advanced profile payload',
);
html = replaceOnce(
  html,
  `async function saveProfile(){const payload=profilePayload();if(!payload.name)return toast('Name fehlt');try{`,
  `async function saveProfile(){const payload=profilePayload();if(!payload.name)return toast('Name fehlt');if(!Number.isFinite(payload.hot_threshold)||payload.hot_threshold<0||payload.hot_threshold>1)return toast('HOT-Schwelle muss zwischen 0 und 1 liegen');if(!Number.isInteger(payload.max_ai_turns)||payload.max_ai_turns<1||payload.max_ai_turns>50)return toast('KI-Runden müssen zwischen 1 und 50 liegen');if(!Number.isFinite(payload.temperature)||payload.temperature<0||payload.temperature>2)return toast('Temperatur muss zwischen 0 und 2 liegen');try{`,
  'profile validation',
);
html = replaceOnce(
  html,
  `async function unlinkProfile(){if(!state.editingProfile||!confirm('WhatsApp-Verknüpfung lösen?'))return;await api('/api/profiles/'+state.editingProfile+'/unlink',{method:'POST',body:'{}'});toast('Verknüpfung gelöst');await load();editProfile(state.editingProfile)}`,
  `async function unlinkProfile(){if(!state.editingProfile||!confirm('WhatsApp-Verknüpfung lösen?'))return;await api('/api/profiles/'+state.editingProfile+'/unlink',{method:'POST',body:'{}'});toast('Verknüpfung gelöst');await load();editProfile(state.editingProfile)}\nasync function deleteProfile(){if(!state.editingProfile||!confirm('Profil wirklich löschen? Chats und gespeicherte Sitzungsdaten dieses Profils werden entfernt.'))return;const id=state.editingProfile;await api('/api/profiles/'+id,{method:'DELETE'});state.editingProfile=null;if(state.selectedProfile===id)state.selectedProfile='';closeModal('profileModal');toast('Profil gelöscht');await load()}`,
  'profile delete action',
);
html = replaceOnce(
  html,
  `async function connectProfile(){if(!state.editingProfile)return;$('qrModal').classList.add('open');$('qrImage').style.display='none';$('qrStatus').style.display='block';$('qrStatus').textContent='QR wird erzeugt …';try{await api('/api/profiles/'+state.editingProfile+'/connect',{method:'POST',body:'{}'});pollQr(state.editingProfile)}catch(e){$('qrStatus').textContent=e.message}}\nasync function pollQr(id){for(let i=0;i<60;i++){await new Promise(r=>setTimeout(r,1500));try{const c=await api('/api/profiles/'+id+'/connection');if(c.status==='online'){$('qrStatus').style.display='block';$('qrStatus').textContent='✅ Verbunden';$('qrImage').style.display='none';toast('WhatsApp verbunden');await load();return}if(c.qr){$('qrImage').src=c.qr;$('qrImage').style.display='block';$('qrStatus').style.display='none'}}catch{}}$('qrStatus').style.display='block';$('qrStatus').textContent='QR abgelaufen. Bitte erneut starten.'}`,
  `async function connectProfile(){if(!state.editingProfile)return;const token=++state.qrPollToken;$('qrModal').classList.add('open');$('qrImage').style.display='none';$('qrStatus').style.display='block';$('qrStatus').textContent='QR wird erzeugt …';try{await api('/api/profiles/'+state.editingProfile+'/connect',{method:'POST',body:'{}'});pollQr(state.editingProfile,token)}catch(e){$('qrStatus').textContent=e.message}}\nasync function pollQr(id,token){for(let i=0;i<60;i++){if(token!==state.qrPollToken)return;await new Promise(r=>setTimeout(r,1500));if(token!==state.qrPollToken)return;try{const c=await api('/api/profiles/'+id+'/connection');if(c.status==='online'){$('qrStatus').style.display='block';$('qrStatus').textContent='✅ Verbunden';$('qrImage').style.display='none';toast('WhatsApp verbunden');await load();return}if(c.qr){$('qrImage').src=c.qr;$('qrImage').style.display='block';$('qrStatus').style.display='none'}}catch{}}if(token===state.qrPollToken){$('qrStatus').style.display='block';$('qrStatus').textContent='QR abgelaufen. Bitte erneut starten.'}}`,
  'QR polling cancellation',
);
writeFileSync('public/index.html', html);

console.log('prepare-build: production hardening applied');
