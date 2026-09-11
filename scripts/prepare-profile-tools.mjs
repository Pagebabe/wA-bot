import { readFileSync, writeFileSync } from 'node:fs';

function replaceOnce(source, before, after, label) {
  if (source.includes(after)) return source;
  if (!source.includes(before)) throw new Error(`prepare-profile-tools: pattern missing: ${label}`);
  return source.replace(before, after);
}

const htmlPath = 'public/index.html';
let html = readFileSync(htmlPath, 'utf8');

html = replaceOnce(
  html,
  '</style>',
  `.quickBar{display:none;gap:7px;overflow-x:auto;padding:7px 10px;background:#182229;border-top:1px solid var(--line)}.quickBar.show{display:flex}.quickReply{white-space:nowrap;border:1px solid #36505a;background:#203139;border-radius:999px;padding:7px 10px;color:#d9fdd3;font-size:12px}.composer{grid-template-columns:auto minmax(0,1fr) auto}.mediaGrid{display:grid;grid-template-columns:repeat(auto-fill,minmax(120px,1fr));gap:10px}.mediaTile{border:1px solid var(--line);background:#182229;border-radius:10px;padding:7px;text-align:left}.mediaTile img{width:100%;aspect-ratio:1/1;object-fit:cover;border-radius:8px;display:block}.avatar img{width:100%;height:100%;object-fit:cover;display:block}.composerMedia:disabled{opacity:.45;cursor:not-allowed}</style>`,
  'profile tools CSS',
);

html = replaceOnce(
  html,
  '<footer class="composer"><textarea id="composer" rows="1" placeholder="Chat zuerst übernehmen" disabled></textarea><button class="sendBtn" onclick="sendMessage()" disabled>➤</button></footer>',
  '<div id="quickBar" class="quickBar"></div><footer class="composer"><button id="mediaBtn" class="icon composerMedia" title="Profilbilder senden" aria-label="Profilbilder senden" onclick="openMediaPicker()" disabled>🖼</button><textarea id="composer" rows="1" placeholder="Chat zuerst übernehmen" disabled></textarea><button class="sendBtn" onclick="sendMessage()" disabled>➤</button></footer>',
  'composer quick replies and media button',
);

html = replaceOnce(
  html,
  '<div class="grid2"><div class="field"><label>Name</label><input id="pName"></div><div class="field"><label>Nummer / Label</label><input id="pPhone" placeholder="z. B. Köln 1"></div>',
  '<div class="grid2"><div class="field"><label>Name</label><input id="pName"></div><div class="field"><label>Profilbild-URL</label><input id="pAvatar" placeholder="https://…"></div><div class="field"><label>Nummer / Label</label><input id="pPhone" placeholder="z. B. Köln 1"></div>',
  'profile avatar field',
);

html = replaceOnce(
  html,
  '<div class="field" style="margin-top:10px"><label>Medien-URLs · eine pro Zeile</label><textarea id="pMedia" placeholder="https://…"></textarea></div>',
  '<div class="field" style="margin-top:10px"><label>Schnellantworten · eine pro Zeile</label><textarea id="pQuick" placeholder="Hallo 👋\\nJa, heute ist noch etwas frei.\\nDer Preis beträgt …"></textarea></div><div class="field" style="margin-top:10px"><label>Bilder zum Senden · HTTPS-URL, eine pro Zeile</label><textarea id="pMedia" placeholder="https://…"></textarea></div>',
  'quick replies field',
);

html = replaceOnce(
  html,
  '<div id="qrModal" class="modal">',
  '<div id="mediaModal" class="modal"><div class="modalCard"><div class="modalHead"><b>Bilder dieses Profils</b><button class="icon" onclick="closeModal(\'mediaModal\')">✕</button></div><div class="modalBody"><div id="mediaGrid" class="mediaGrid"></div></div></div></div>\n<div id="qrModal" class="modal">',
  'media picker modal',
);

html = replaceOnce(
  html,
  "function renderProfileRows(){$('profileRows').innerHTML=state.profiles.map(p=>`<button class=\"profileManage\" onclick=\"closeModal('profilesModal');editProfile('${p.id}')\"><span class=\"avatar\">${esc(initials(p.name))}</span><span><b>${esc(p.name)}</b><br><small style=\"color:var(--muted)\">${esc(p.location||p.phone_label||'Nicht eingerichtet')} · ${esc(p.connection?.status||p.status||'offline')}</small></span><span>›</span></button>`).join('')||'<div class=\"emptyList\">Noch keine Profile</div>'}",
  "function renderProfileRows(){$('profileRows').innerHTML=state.profiles.map(p=>`<button class=\"profileManage\" onclick=\"closeModal('profilesModal');editProfile('${p.id}')\"><span class=\"avatar\">${p.avatar_url?`<img src=\"${esc(p.avatar_url)}\" alt=\"\">`:esc(initials(p.name))}</span><span><b>${esc(p.name)}</b><br><small style=\"color:var(--muted)\">${esc(p.location||p.phone_label||'Nicht eingerichtet')} · ${esc(p.connection?.status||p.status||'offline')}</small></span><span>›</span></button>`).join('')||'<div class=\"emptyList\">Noch keine Profile</div>'}",
  'profile avatar rendering',
);

html = replaceOnce(
  html,
  "$('pMedia').value=Array.isArray(p.media)?p.media.join('\\n'):''}",
  "$('pMedia').value=Array.isArray(p.media)?p.media.filter(x=>typeof x==='string').join('\\n'):'';$('pAvatar').value=p.avatar_url||'';$('pQuick').value=Array.isArray(p.quick_replies)?p.quick_replies.join('\\n'):''}",
  'profile tools fill',
);

html = replaceOnce(
  html,
  "media:$('pMedia').value.split(/\\n+/).map(x=>x.trim()).filter(Boolean)}}",
  "media:$('pMedia').value.split(/\\n+/).map(x=>x.trim()).filter(Boolean),avatar_url:$('pAvatar').value.trim()||null,quick_replies:$('pQuick').value.split(/\\n+/).map(x=>x.trim()).filter(Boolean)}}",
  'profile tools payload',
);

html = replaceOnce(
  html,
  "document.querySelector('.sendBtn').disabled=!canWrite}",
  "document.querySelector('.sendBtn').disabled=!canWrite;$('mediaBtn').disabled=!canWrite;renderQuickBar()}",
  'profile tools ownership state',
);

const tailAnchor = "async function seedHot(){try{await api('/api/demo/hot',{method:'POST',body:'{}'});await load();toast('Demo-HOT-Lead erstellt');closeModal('settingsModal');setFilter('hot')}catch(e){toast(e.message)}}";
const profileToolsFns = `${tailAnchor}\nfunction renderQuickBar(){const bar=$('quickBar');const c=state.currentChat;if(!bar||!c||c.state!=='HUMAN_ACTIVE'){if(bar){bar.classList.remove('show');bar.innerHTML=''}return}const p=profileBy(c.profile_id);const replies=Array.isArray(p?.quick_replies)?p.quick_replies.filter(x=>typeof x==='string'&&x.trim()):[];bar.innerHTML=replies.map((r,i)=>'<button class=\"quickReply\" onclick=\"sendQuickReply('+i+')\">'+esc(r)+'</button>').join('');bar.classList.toggle('show',replies.length>0)}\nasync function sendQuickReply(i){const c=state.currentChat;if(!c||c.state!=='HUMAN_ACTIVE')return toast('Chat zuerst übernehmen');const p=profileBy(c.profile_id);const replies=Array.isArray(p?.quick_replies)?p.quick_replies:[];const text=String(replies[i]||'').trim();if(!text)return;try{await api('/api/conversations/'+c.id+'/send',{method:'POST',body:JSON.stringify({text})});await loadMessages(c.id);await load();toast('Schnellantwort gesendet')}catch(e){toast(e.message)}}\nfunction openMediaPicker(){const c=state.currentChat;if(!c||c.state!=='HUMAN_ACTIVE')return toast('Chat zuerst übernehmen');const p=profileBy(c.profile_id);const media=Array.isArray(p?.media)?p.media.filter(x=>typeof x==='string'&&/^https:\\/\\//i.test(x)):[];const grid=$('mediaGrid');grid.innerHTML=media.map((url,i)=>'<button class=\"mediaTile\" onclick=\"sendProfileMedia('+i+')\"><img src=\"'+esc(url)+'\" alt=\"Bild '+(i+1)+'\"><div style=\"margin-top:6px\">Senden</div></button>').join('')||'<div class=\"emptyList\">Für dieses Profil sind noch keine Bilder hinterlegt.</div>';$('mediaModal').classList.add('open')}\nasync function sendProfileMedia(i){const c=state.currentChat;if(!c||c.state!=='HUMAN_ACTIVE')return;const p=profileBy(c.profile_id);const media=Array.isArray(p?.media)?p.media.filter(x=>typeof x==='string'&&/^https:\\/\\//i.test(x)):[];const url=media[i];if(!url)return;try{await api('/api/conversations/'+c.id+'/send-media',{method:'POST',body:JSON.stringify({url})});closeModal('mediaModal');await loadMessages(c.id);await load();toast('Bild gesendet')}catch(e){toast(e.message)}}`;
html = replaceOnce(html, tailAnchor, profileToolsFns, 'profile tools functions');

writeFileSync(htmlPath, html);

const serverPath = 'src/server.ts';
let server = readFileSync(serverPath, 'utf8');

server = replaceOnce(
  server,
  '  sendText,\n  sendVoiceAudio,',
  '  sendText,\n  sendImageUrl,\n  sendVoiceAudio,',
  'image sender import',
);

server = replaceOnce(
  server,
  "    hours_text: body.hours_text || '',\n    bot_enabled: body.bot_enabled !== false,",
  "    hours_text: body.hours_text || '',\n    avatar_url: body.avatar_url || null,\n    quick_replies: Array.isArray(body.quick_replies) ? body.quick_replies : [],\n    bot_enabled: body.bot_enabled !== false,",
  'profile create avatar and quick replies',
);

server = replaceOnce(
  server,
  "    'preset_name', 'llm_model_override', 'temperature', 'voice_name', 'media',",
  "    'preset_name', 'llm_model_override', 'temperature', 'voice_name', 'media', 'quick_replies',",
  'profile patch quick replies',
);

server = replaceOnce(
  server,
  "app.post('/api/demo/hot', async () => {",
  "app.post('/api/conversations/:id/send-media', async (request, reply) => {\n  const id = (request.params as any).id;\n  const body: any = request.body || {};\n  const url = String(body.url || '').trim();\n  if (!/^https:\\/\\//i.test(url)) return reply.code(400).send({ error: 'Nur HTTPS-Bilder sind erlaubt' });\n  const c = (await conversations()).find((x) => x.id === id);\n  if (!c) return reply.code(404).send({ error: 'Chat nicht gefunden' });\n  if (c.state !== 'HUMAN_ACTIVE') return reply.code(409).send({ error: 'Chat muss zuerst übernommen werden' });\n  const profile = await getProfile(c.profile_id);\n  const allowed = Array.isArray(profile.media) ? profile.media.filter((x): x is string => typeof x === 'string') : [];\n  if (!allowed.includes(url)) return reply.code(403).send({ error: 'Bild gehört nicht zur Medienliste dieses Profils' });\n  const sentId = await sendImageUrl(c.profile_id, c.wa_jid, url);\n  await addMessage({ conversation_id: id, wa_message_id: sentId, direction: 'out', sender: 'human', kind: 'image', media_url: url, text: '' });\n  await updateConversation(id, { state: 'HUMAN_ACTIVE', unread_count: 0, last_message_preview: '🖼 Bild', last_message_at: new Date().toISOString() });\n  return { ok: true, kind: 'image' };\n});\n\napp.post('/api/demo/hot', async () => {",
  'profile media send route',
);

writeFileSync(serverPath, server);
console.log('prepare-profile-tools: quick replies, media picker and profile avatars applied');
