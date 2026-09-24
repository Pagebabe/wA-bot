import { readFileSync, writeFileSync } from 'node:fs';

function replaceOnce(source, before, after, label) {
  if (source.includes(after)) return source;
  if (!source.includes(before)) throw new Error(`prepare-quick-actions: pattern missing: ${label}`);
  return source.replace(before, after);
}

let wa = readFileSync('src/whatsapp.ts', 'utf8');
wa = replaceOnce(
  wa,
  "export async function sendVoiceAudio(profileId: string, jid: string, audio: Buffer) {",
  "export async function sendVoiceAudio(profileId: string, jid: string, audio: Buffer, mime = 'audio/mpeg') {",
  'baileys voice mime signature',
);
wa = replaceOnce(
  wa,
  "const sent = await session.socket.sendMessage(jid, { audio, mimetype: 'audio/mpeg', ptt: true });",
  "const sent = await session.socket.sendMessage(jid, { audio, mimetype: mime, ptt: true });",
  'baileys voice mime payload',
);
writeFileSync('src/whatsapp.ts', wa);

let provider = readFileSync('src/whatsapp-provider.ts', 'utf8');
provider = replaceOnce(
  provider,
  "export async function sendVoiceAudio(profileId: string, jid: string, audio: Buffer) {\n  if (!isEvolution()) return baileys.sendVoiceAudio(profileId, jid, audio);",
  "export async function sendVoiceAudio(profileId: string, jid: string, audio: Buffer, mime = 'audio/mpeg') {\n  if (!isEvolution()) return baileys.sendVoiceAudio(profileId, jid, audio, mime);",
  'provider voice mime signature',
);
writeFileSync('src/whatsapp-provider.ts', provider);

let server = readFileSync('src/server.ts', 'utf8');
server = replaceOnce(
  server,
  "app.post('/api/demo/hot', async () => {",
  `app.post('/api/conversations/:id/send-tts', async (request, reply) => {
  const id = (request.params as any).id;
  const body: any = request.body || {};
  const text = String(body.text || '').trim();
  if (!text) return reply.code(400).send({ error: 'Text fehlt' });
  if (text.length > 1200) return reply.code(400).send({ error: 'Text ist zu lang (maximal 1200 Zeichen)' });
  const c = (await conversations()).find((x) => x.id === id);
  if (!c) return reply.code(404).send({ error: 'Chat nicht gefunden' });
  if (c.state !== 'HUMAN_ACTIVE') return reply.code(409).send({ error: 'Chat muss zuerst übernommen werden' });
  const currentSettings = await settings();
  try {
    const audio = await synthesizeVoice(currentSettings as LlmSettings, text, 'alloy');
    const sentId = await sendVoiceAudio(c.profile_id, c.wa_jid, audio.buffer, audio.mime);
    await addMessage({ conversation_id: id, wa_message_id: sentId, direction: 'out', sender: 'human', kind: 'voice', text });
    await updateConversation(id, { state: 'HUMAN_ACTIVE', unread_count: 0, last_message_preview: ('🎙 ' + text).slice(0, 180), last_message_at: new Date().toISOString() });
    return { ok: true, kind: 'voice' };
  } catch (error) {
    app.log.warn({ err: error }, 'Manual TTS send failed');
    return reply.code(502).send({ error: error instanceof Error ? error.message.slice(0, 300) : 'Sprachausgabe fehlgeschlagen' });
  }
});

app.post('/api/conversations/:id/send-voice-upload', { bodyLimit: 6 * 1024 * 1024 }, async (request, reply) => {
  const id = (request.params as any).id;
  const body: any = request.body || {};
  const mimeRaw = String(body.mime || '').trim().toLowerCase();
  const mime = mimeRaw.split(';')[0];
  const allowedMime = new Set(['audio/webm', 'audio/ogg', 'audio/mp4', 'audio/mpeg']);
  if (!allowedMime.has(mime)) return reply.code(400).send({ error: 'Nicht unterstütztes Audioformat' });
  const encoded = String(body.audio_base64 || '').trim();
  if (!encoded || !/^[A-Za-z0-9+/]+={0,2}$/.test(encoded)) return reply.code(400).send({ error: 'Ungültige Audiodaten' });
  const audio = Buffer.from(encoded, 'base64');
  if (!audio.length) return reply.code(400).send({ error: 'Audiodatei ist leer' });
  if (audio.length > 4 * 1024 * 1024) return reply.code(413).send({ error: 'Sprachnachricht ist zu groß (maximal 4 MB)' });
  const c = (await conversations()).find((x) => x.id === id);
  if (!c) return reply.code(404).send({ error: 'Chat nicht gefunden' });
  if (c.state !== 'HUMAN_ACTIVE') return reply.code(409).send({ error: 'Chat muss zuerst übernommen werden' });
  try {
    const sentId = await sendVoiceAudio(c.profile_id, c.wa_jid, audio, mime);
    await addMessage({ conversation_id: id, wa_message_id: sentId, direction: 'out', sender: 'human', kind: 'voice', text: 'Sprachnachricht' });
    await updateConversation(id, { state: 'HUMAN_ACTIVE', unread_count: 0, last_message_preview: '🎙 Sprachnachricht', last_message_at: new Date().toISOString() });
    return { ok: true, kind: 'voice' };
  } catch (error) {
    app.log.warn({ err: error }, 'Recorded voice send failed');
    return reply.code(502).send({ error: error instanceof Error ? error.message.slice(0, 300) : 'Sprachnachricht konnte nicht gesendet werden' });
  }
});

app.post('/api/demo/hot', async () => {`,
  'voice action routes',
);
writeFileSync('src/server.ts', server);

let html = readFileSync('public/index.html', 'utf8');
html = replaceOnce(
  html,
  '.shell{display:grid;grid-template-columns:58px 390px minmax(0,1fr);height:100vh}',
  '.shell{display:grid;grid-template-columns:58px 390px minmax(0,1fr) 360px;height:100vh}',
  'desktop toolbox grid',
);
html = replaceOnce(
  html,
  '</style>',
  `.toolbox{min-width:0;background:#101a20;border-left:1px solid var(--line);display:flex;flex-direction:column;overflow:hidden}.toolboxHead{min-height:60px;padding:12px 13px;border-bottom:1px solid var(--line);display:flex;align-items:center;justify-content:space-between;gap:9px}.toolboxHead strong{display:block;font-size:14px}.toolboxHead small{display:block;max-width:230px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--muted);font-size:10px;margin-top:2px}.toolboxStatus{font-size:10px;color:var(--green2);white-space:nowrap}.toolTabs{display:grid;grid-template-columns:repeat(4,1fr);gap:5px;padding:8px;border-bottom:1px solid var(--line)}.toolTabs button{border:0;border-radius:8px;background:transparent;color:#9fb0b9;padding:8px 3px;font-size:11px}.toolTabs button:hover{background:#17242b}.toolTabs button.active{background:#0a332c;color:#d9fdd3}.toolPanel{display:none;min-height:0;overflow:auto;flex:1;padding:11px}.toolPanel.active{display:block}.toolSearch{height:38px;background:var(--panel2);border-radius:9px;display:flex;align-items:center;padding:0 9px;color:var(--muted);margin-bottom:9px}.toolSearch input{flex:1;min-width:0;border:0;outline:0;background:transparent;color:var(--text);padding-left:7px}.toolHint{font-size:11px;color:var(--muted);line-height:1.45;margin:2px 2px 11px}.toolList{display:grid;gap:7px}.toolCard{width:100%;border:1px solid #2b3b44;background:#162229;color:var(--text);border-radius:10px;padding:10px;text-align:left;display:grid;gap:4px}.toolCard:hover{border-color:#45606d;background:#1a2930}.toolCard strong{font-size:12px}.toolCard span,.toolCard small{font-size:10px;color:#9fb0b9;line-height:1.4}.toolMeta{display:flex;justify-content:space-between;gap:8px;color:#69808b!important;font-size:9px!important}.toolPhotoGrid{display:grid;grid-template-columns:1fr 1fr;gap:8px}.toolPhoto{border:1px solid #2b3b44;background:#162229;color:var(--text);border-radius:10px;padding:7px;text-align:left}.toolPhoto img{width:100%;height:92px;object-fit:cover;border-radius:7px;display:block;margin-bottom:7px}.toolPhoto strong{font-size:11px;display:block}.toolBlock{border:1px solid #2b3b44;background:#0d171d;border-radius:11px;padding:10px;margin-bottom:10px}.toolBlockTitle{font-weight:750;font-size:12px;margin-bottom:8px}.toolBlock textarea{width:100%;resize:vertical;min-height:72px;border:1px solid #33444d;outline:0;background:var(--panel2);color:var(--text);border-radius:8px;padding:9px 10px;margin-bottom:8px}.toolActions{display:grid;grid-template-columns:1fr 1fr;gap:7px}.toolActions button,.toolFull{border:1px solid #354650;background:var(--panel2);color:var(--text);border-radius:8px;padding:8px}.toolFull{width:100%}.toolPrimary{background:var(--green)!important;border-color:var(--green)!important;color:#05241d!important;font-weight:800}.toolActions button:disabled,.toolFull:disabled{opacity:.42;cursor:not-allowed}.recordState{font-size:11px;color:var(--muted);margin-bottom:8px}.recordState.recording{color:#ff9da5}.toolBlock audio{width:100%;height:36px;margin:7px 0}.toolboxToggle{display:none}.toolEmpty{padding:18px 8px;color:var(--muted);font-size:11px;text-align:center}.toolBackdrop{display:none}@media(max-width:1350px){.shell{grid-template-columns:58px 340px minmax(0,1fr)}.toolbox{position:fixed;right:0;top:0;bottom:0;width:min(380px,92vw);z-index:85;box-shadow:var(--shadow);transform:translateX(102%);transition:transform .18s ease}.toolbox.open{transform:translateX(0)}.toolboxToggle{display:inline-grid;place-items:center}.toolBackdrop{position:fixed;inset:0;background:rgba(0,0,0,.45);z-index:84}.toolBackdrop.open{display:block}}@media(max-width:900px){.toolbox{width:min(360px,94vw);z-index:120}.toolBackdrop{z-index:119}.toolPhotoGrid{grid-template-columns:1fr 1fr}}</style>`,
  'toolbox styles',
);
html = replaceOnce(
  html,
  '<div class="chatActions"><button id="takeBtn" class="takeBtn"',
  '<div class="chatActions"><button class="icon toolboxToggle" title="Schnellaktionen" aria-label="Schnellaktionen" onclick="toggleQuickToolbox()">🧰</button><button id="takeBtn" class="takeBtn"',
  'toolbox toggle',
);
html = replaceOnce(
  html,
  '  </main>\n</div>',
  `  </main>
  <aside id="quickToolbox" class="toolbox" aria-label="Schnellaktionen">
    <header class="toolboxHead"><div><strong>Schnellaktionen</strong><small id="toolboxContext">Chat auswählen</small></div><span class="toolboxStatus">● bereit</span></header>
    <nav class="toolTabs" aria-label="Werkzeuge">
      <button class="active" type="button" data-tool-tab="replies" onclick="selectQuickTool('replies')">Antworten</button>
      <button type="button" data-tool-tab="photos" onclick="selectQuickTool('photos')">Fotos</button>
      <button type="button" data-tool-tab="location" onclick="selectQuickTool('location')">GPS</button>
      <button type="button" data-tool-tab="voice" onclick="selectQuickTool('voice')">Sprache</button>
    </nav>
    <section class="toolPanel active" data-tool-panel="replies">
      <label class="toolSearch">⌕<input id="toolReplySearch" placeholder="Antwort suchen …" oninput="renderToolReplies()"></label>
      <div class="toolHint">Klick fügt die Vorlage nur in den Entwurf ein. {{name}} wird durch den Kontaktnamen ersetzt.</div>
      <div id="toolReplies" class="toolList"></div>
    </section>
    <section class="toolPanel" data-tool-panel="photos"><div class="toolHint">Profilbilder sowie Haustür/Klingel. Vor dem echten Versand wird bestätigt.</div><div id="toolPhotos" class="toolPhotoGrid"></div></section>
    <section class="toolPanel" data-tool-panel="location"><div class="toolHint">Gespeicherte Profiladresse als nativer WhatsApp-Standort.</div><div id="toolLocations" class="toolList"></div></section>
    <section class="toolPanel" data-tool-panel="voice">
      <div class="toolBlock"><div class="toolBlockTitle">Vorgefertigte Sprachnachrichten</div><div id="toolVoicePresets" class="toolList"></div></div>
      <div class="toolBlock"><div class="toolBlockTitle">Sprachnachricht aufnehmen</div><div id="recordState" class="recordState">Bereit zur Aufnahme</div><div class="toolActions"><button id="recordButton" type="button" onclick="startVoiceRecording()">● Aufnahme</button><button id="stopRecordButton" type="button" onclick="stopVoiceRecording()" disabled>■ Stop</button></div><audio id="voicePreview" controls hidden></audio><div class="toolActions"><button id="discardRecordingButton" type="button" onclick="discardVoiceRecording()" disabled>Verwerfen</button><button id="sendRecordingButton" class="toolPrimary" type="button" onclick="sendVoiceRecording()" disabled>Senden</button></div></div>
      <div class="toolBlock"><div class="toolBlockTitle">Text → Sprache</div><textarea id="toolTtsText" maxlength="1200" placeholder="Text für die Sprachnachricht …"></textarea><button class="toolFull toolPrimary" type="button" onclick="sendToolTts()">Als Sprache senden</button></div>
    </section>
  </aside>
</div>
<div id="toolBackdrop" class="toolBackdrop" onclick="closeQuickToolbox()"></div>`,
  'toolbox markup',
);

const toolboxScript = `
let activeQuickTool='replies';
let quickRecorder=null;
let quickRecorderStream=null;
let quickRecordedBlob=null;
let quickRecordedUrl=null;
let quickRecordingTimer=null;
const QUICK_AUDIO_MAX_BYTES=4*1024*1024;

function quickChatProfile(){const c=state.currentChat;return c?profileBy(c.profile_id):null}
function quickCanSend(){return Boolean(state.currentChat&&state.currentChat.state==='HUMAN_ACTIVE')}
function expandQuickTemplate(value){const c=state.currentChat;return String(value||'').replaceAll('{{name}}',c?.contact_name||'')}
function selectQuickTool(name){activeQuickTool=name;document.querySelectorAll('[data-tool-tab]').forEach(x=>x.classList.toggle('active',x.dataset.toolTab===name));document.querySelectorAll('[data-tool-panel]').forEach(x=>x.classList.toggle('active',x.dataset.toolPanel===name))}
function toggleQuickToolbox(){$('quickToolbox')?.classList.toggle('open');$('toolBackdrop')?.classList.toggle('open',$('quickToolbox')?.classList.contains('open'))}
function closeQuickToolbox(){$('quickToolbox')?.classList.remove('open');$('toolBackdrop')?.classList.remove('open')}
function quickEmpty(text){const d=document.createElement('div');d.className='toolEmpty';d.textContent=text;return d}
function renderToolReplies(){const root=$('toolReplies');if(!root)return;root.replaceChildren();const p=quickChatProfile();const q=String($('toolReplySearch')?.value||'').trim().toLowerCase();const replies=(Array.isArray(p?.quick_replies)?p.quick_replies:[]).filter(x=>typeof x==='string'&&x.trim()).filter(x=>!q||x.toLowerCase().includes(q));if(!replies.length){root.append(quickEmpty(state.currentChat?'Keine passende Vorlage.':'Chat auswählen.'));return}replies.forEach((raw)=>{const text=expandQuickTemplate(raw);const b=document.createElement('button');b.type='button';b.className='toolCard';const strong=document.createElement('strong');strong.textContent='Antwortvorlage';const body=document.createElement('span');body.textContent=text;const meta=document.createElement('span');meta.className='toolMeta';const left=document.createElement('span');left.textContent='Vorlage';const right=document.createElement('span');right.textContent='in Entwurf';meta.append(left,right);b.append(strong,body,meta);b.onclick=()=>{if(!state.currentChat)return toast('Chat auswählen');$('composer').value=text;$('composer').focus()};root.append(b)})}
function collectToolPhotos(){const p=quickChatProfile();const out=[];(Array.isArray(p?.media)?p.media:[]).forEach((url,i)=>{if(typeof url==='string'&&/^https:\\/\\//i.test(url))out.push({kind:'media',label:'Profilbild '+(i+1),url,index:i})});const ep=p?.entry_photos||{};if(typeof ep.door_url==='string'&&/^https:\\/\\//i.test(ep.door_url))out.push({kind:'entry',type:'door',label:'Haustür',url:ep.door_url});if(typeof ep.bell_url==='string'&&/^https:\\/\\//i.test(ep.bell_url))out.push({kind:'entry',type:'bell',label:'Klingel',url:ep.bell_url});return out}
function renderToolPhotos(){const root=$('toolPhotos');if(!root)return;root.replaceChildren();const photos=collectToolPhotos();if(!photos.length){root.append(quickEmpty(state.currentChat?'Keine Profilfotos hinterlegt.':'Chat auswählen.'));return}photos.forEach((item,i)=>{const b=document.createElement('button');b.type='button';b.className='toolPhoto';const img=document.createElement('img');img.src=item.url;img.alt=item.label;img.loading='lazy';const label=document.createElement('strong');label.textContent=item.label;const hint=document.createElement('small');hint.textContent='Vorschau · Klick zum Bestätigen';b.append(img,label,hint);b.onclick=()=>sendToolPhoto(i);root.append(b)})}
async function sendToolPhoto(i){if(!quickCanSend())return toast('Chat zuerst übernehmen');const item=collectToolPhotos()[i];if(!item)return;if(!confirm(item.label+' wirklich senden?'))return;const c=state.currentChat;try{if(item.kind==='entry')await api('/api/conversations/'+c.id+'/send-entry-photo',{method:'POST',body:JSON.stringify({type:item.type})});else await api('/api/conversations/'+c.id+'/send-media',{method:'POST',body:JSON.stringify({url:item.url})});await loadMessages(c.id);await load();toast(item.label+' gesendet');closeQuickToolbox()}catch(e){toast(e.message)}}
function renderToolLocations(){const root=$('toolLocations');if(!root)return;root.replaceChildren();const p=quickChatProfile(),loc=p?.share_location;if(!loc?.address){root.append(quickEmpty(state.currentChat?'Kein GPS-Standort im Profil hinterlegt.':'Chat auswählen.'));return}const b=document.createElement('button');b.type='button';b.className='toolCard';const strong=document.createElement('strong');strong.textContent='📍 '+(loc.label||p.name||'Standort');const body=document.createElement('span');body.textContent=loc.address;const meta=document.createElement('span');meta.className='toolMeta';const left=document.createElement('span');left.textContent=Number(loc.latitude).toFixed(5)+', '+Number(loc.longitude).toFixed(5);const right=document.createElement('span');right.textContent='WhatsApp GPS';meta.append(left,right);b.append(strong,body,meta);b.onclick=sendToolLocation;root.append(b)}
async function sendToolLocation(){if(!quickCanSend())return toast('Chat zuerst übernehmen');const p=quickChatProfile(),loc=p?.share_location;if(!loc?.address)return toast('Kein GPS-Standort hinterlegt');if(!confirm((loc.label||p.name||'Standort')+' wirklich senden?'))return;const c=state.currentChat;try{await api('/api/conversations/'+c.id+'/send-location',{method:'POST',body:'{}'});await loadMessages(c.id);await load();toast('Standort gesendet');closeQuickToolbox()}catch(e){toast(e.message)}}
function renderToolVoicePresets(){const root=$('toolVoicePresets');if(!root)return;root.replaceChildren();const p=quickChatProfile();const replies=(Array.isArray(p?.quick_replies)?p.quick_replies:[]).filter(x=>typeof x==='string'&&x.trim());if(!replies.length){root.append(quickEmpty(state.currentChat?'Keine Vorlagen vorhanden. Hinterlege Schnellantworten im Profil.':'Chat auswählen.'));return}replies.forEach((raw,i)=>{const text=expandQuickTemplate(raw);const b=document.createElement('button');b.type='button';b.className='toolCard';const strong=document.createElement('strong');strong.textContent='🎙 Sprachvorlage '+(i+1);const body=document.createElement('span');body.textContent=text;const meta=document.createElement('span');meta.className='toolMeta';const left=document.createElement('span');left.textContent='TTS';const right=document.createElement('span');right.textContent='bewusst senden';meta.append(left,right);b.append(strong,body,meta);b.onclick=()=>sendPresetVoice(text);root.append(b)})}
async function sendPresetVoice(text){if(!quickCanSend())return toast('Chat zuerst übernehmen');if(!confirm('Diese Sprachvorlage senden?'))return;await sendTtsText(text)}
async function sendTtsText(text){const c=state.currentChat;if(!c)return;try{await api('/api/conversations/'+c.id+'/send-tts',{method:'POST',body:JSON.stringify({text})});await loadMessages(c.id);await load();toast('Sprachnachricht gesendet');closeQuickToolbox()}catch(e){toast(e.message)}}
async function sendToolTts(){const text=String($('toolTtsText')?.value||'').trim();if(!text)return toast('Text fehlt');if(!quickCanSend())return toast('Chat zuerst übernehmen');if(!confirm('Text als Sprachnachricht senden?'))return;await sendTtsText(text);if($('toolTtsText'))$('toolTtsText').value=''}
function preferredRecorderMime(){const options=['audio/webm;codecs=opus','audio/ogg;codecs=opus','audio/mp4','audio/webm'];return options.find(x=>typeof MediaRecorder!=='undefined'&&MediaRecorder.isTypeSupported?.(x))||''}
async function startVoiceRecording(){if(!quickCanSend())return toast('Chat zuerst übernehmen');if(!navigator.mediaDevices?.getUserMedia||typeof MediaRecorder==='undefined')return toast('Mikrofonaufnahme wird von diesem Browser nicht unterstützt');discardVoiceRecording();try{quickRecorderStream=await navigator.mediaDevices.getUserMedia({audio:true});const chunks=[];const mime=preferredRecorderMime();quickRecorder=new MediaRecorder(quickRecorderStream,mime?{mimeType:mime}:undefined);quickRecorder.ondataavailable=e=>{if(e.data.size)chunks.push(e.data)};quickRecorder.onstop=()=>{quickRecorderStream?.getTracks().forEach(t=>t.stop());quickRecorderStream=null;quickRecordedBlob=new Blob(chunks,{type:quickRecorder?.mimeType||mime||'audio/webm'});if(quickRecordedBlob.size>QUICK_AUDIO_MAX_BYTES){discardVoiceRecording();toast('Aufnahme ist größer als 4 MB');return}quickRecordedUrl=URL.createObjectURL(quickRecordedBlob);$('voicePreview').src=quickRecordedUrl;$('voicePreview').hidden=false;$('sendRecordingButton').disabled=false;$('discardRecordingButton').disabled=false;$('recordButton').disabled=false;$('stopRecordButton').disabled=true;$('recordState').classList.remove('recording');$('recordState').textContent='Aufnahme bereit · '+Math.ceil(quickRecordedBlob.size/1024)+' KB'};quickRecorder.start(250);$('recordButton').disabled=true;$('stopRecordButton').disabled=false;$('recordState').classList.add('recording');$('recordState').textContent='● Aufnahme läuft …';quickRecordingTimer=setTimeout(stopVoiceRecording,90000)}catch(e){$('recordState').textContent='Mikrofon nicht verfügbar';toast(e.message)}}
function stopVoiceRecording(){if(quickRecordingTimer){clearTimeout(quickRecordingTimer);quickRecordingTimer=null}if(quickRecorder?.state==='recording')quickRecorder.stop()}
function discardVoiceRecording(){if(quickRecordingTimer){clearTimeout(quickRecordingTimer);quickRecordingTimer=null}if(quickRecorder?.state==='recording')quickRecorder.stop();quickRecorderStream?.getTracks().forEach(t=>t.stop());quickRecorderStream=null;if(quickRecordedUrl)URL.revokeObjectURL(quickRecordedUrl);quickRecordedUrl=null;quickRecordedBlob=null;if($('voicePreview')){$('voicePreview').pause();$('voicePreview').removeAttribute('src');$('voicePreview').load();$('voicePreview').hidden=true}$('sendRecordingButton')&&($('sendRecordingButton').disabled=true);$('discardRecordingButton')&&($('discardRecordingButton').disabled=true);$('stopRecordButton')&&($('stopRecordButton').disabled=true);$('recordButton')&&($('recordButton').disabled=false);if($('recordState')){$('recordState').classList.remove('recording');$('recordState').textContent='Bereit zur Aufnahme'}}
function blobToBase64(blob){return new Promise((resolve,reject)=>{const r=new FileReader();r.onerror=()=>reject(r.error||new Error('Datei konnte nicht gelesen werden'));r.onload=()=>resolve(String(r.result||'').split(',')[1]||'');r.readAsDataURL(blob)})}
async function sendVoiceRecording(){if(!quickRecordedBlob)return toast('Keine Aufnahme vorhanden');if(!quickCanSend())return toast('Chat zuerst übernehmen');if(!confirm('Aufgenommene Sprachnachricht senden?'))return;const c=state.currentChat;try{const audio_base64=await blobToBase64(quickRecordedBlob);await api('/api/conversations/'+c.id+'/send-voice-upload',{method:'POST',body:JSON.stringify({audio_base64,mime:quickRecordedBlob.type||'audio/webm'})});discardVoiceRecording();await loadMessages(c.id);await load();toast('Sprachnachricht gesendet');closeQuickToolbox()}catch(e){toast(e.message)}}
function renderQuickToolbox(){const ctx=$('toolboxContext');if(ctx){const c=state.currentChat,p=quickChatProfile();ctx.textContent=c?(c.contact_name||c.wa_jid)+' · '+(p?.name||'Profil'):'Chat auswählen'}renderToolReplies();renderToolPhotos();renderToolLocations();renderToolVoicePresets();selectQuickTool(activeQuickTool)}
document.addEventListener('keydown',e=>{if(e.key==='Escape')closeQuickToolbox()});
`;

html = replaceOnce(
  html,
  "function render(){renderProfileSelect();renderProfileRows();renderChatList();const hot=",
  "function render(){renderProfileSelect();renderProfileRows();renderChatList();renderQuickToolbox();const hot=",
  'toolbox render hook',
);
html = replaceOnce(
  html,
  "renderChatHeader();renderChatList();await loadMessages()}",
  "renderChatHeader();renderChatList();renderQuickToolbox();await loadMessages()}",
  'toolbox chat-open hook',
);
html = replaceOnce(
  html,
  '\n</script>\n</body>',
  `${toolboxScript}
</script>
</body>`,
  'toolbox client logic',
);
writeFileSync('public/index.html', html);

console.log('prepare-quick-actions: right-side reply/photo/GPS/voice toolbox applied');
