import { readFileSync, writeFileSync } from 'node:fs';

function replaceOnce(source, before, after, label) {
  if (source.includes(after)) return source;
  if (!source.includes(before)) throw new Error(`prepare-profile-complete: pattern missing: ${label}`);
  return source.replace(before, after);
}

let store = readFileSync('src/store.ts', 'utf8');
store = replaceOnce(
  store,
  "  location?: string | null;\n  price_text?: string | null;",
  "  location?: string | null;\n  desired_location?: string | null;\n  price_text?: string | null;",
  'profile desired location type',
);
store = replaceOnce(
  store,
  "  media?: unknown[] | null;\n  preset_name?: string | null;",
  "  media?: string[] | null;\n  quick_replies?: string[] | null;\n  preset_name?: string | null;",
  'profile assets type',
);
writeFileSync('src/store.ts', store);

let ai = readFileSync('src/ai.ts', 'utf8');
ai = replaceOnce(
  ai,
  "    profile.location ? `Ort: ${profile.location}` : '',\n    profile.price_text ? `Preise: ${profile.price_text}` : '',",
  "    profile.location ? `Ort: ${profile.location}` : '',\n    profile.desired_location ? `Wunschstandort / Einsatzgebiet: ${profile.desired_location}` : '',\n    profile.price_text ? `Preise: ${profile.price_text}` : '',",
  'desired location in AI context',
);
writeFileSync('src/ai.ts', ai);

let wa = readFileSync('src/whatsapp.ts', 'utf8');
wa = replaceOnce(
  wa,
  "export async function sendVoiceAudio(profileId: string, jid: string, audio: Buffer) {\n  const session = sessions.get(profileId);\n  if (!session?.socket || session.status !== 'online') throw new Error('WhatsApp profile is not online');\n  const sent = await session.socket.sendMessage(jid, { audio, mimetype: 'audio/mpeg', ptt: true });\n  return sent?.key?.id || null;\n}\n",
  "export async function sendVoiceAudio(profileId: string, jid: string, audio: Buffer) {\n  const session = sessions.get(profileId);\n  if (!session?.socket || session.status !== 'online') throw new Error('WhatsApp profile is not online');\n  const sent = await session.socket.sendMessage(jid, { audio, mimetype: 'audio/mpeg', ptt: true });\n  return sent?.key?.id || null;\n}\n\nexport async function sendImageUrl(profileId: string, jid: string, url: string, caption = '') {\n  const session = sessions.get(profileId);\n  if (!session?.socket || session.status !== 'online') throw new Error('WhatsApp profile is not online');\n  const sent = await session.socket.sendMessage(jid, { image: { url }, ...(caption ? { caption } : {}) });\n  return sent?.key?.id || null;\n}\n",
  'image sender',
);
writeFileSync('src/whatsapp.ts', wa);

let server = readFileSync('src/server.ts', 'utf8');
server = replaceOnce(
  server,
  "  sendText,\n  sendVoiceAudio,",
  "  sendText,\n  sendVoiceAudio,\n  sendImageUrl,",
  'image sender import',
);
server = replaceOnce(
  server,
  "    'name', 'phone_label', 'location', 'price_text', 'hours_text', 'avatar_url',\n",
  "    'name', 'phone_label', 'location', 'desired_location', 'price_text', 'hours_text', 'avatar_url',\n",
  'profile patch desired location whitelist',
);
server = replaceOnce(
  server,
  "    'preset_name', 'llm_model_override', 'temperature', 'voice_name', 'media',\n",
  "    'preset_name', 'llm_model_override', 'temperature', 'voice_name', 'media', 'quick_replies',\n",
  'profile patch quick replies whitelist',
);
server = replaceOnce(
  server,
  "    location: body.location || '',\n    price_text: body.price_text || '',",
  "    location: body.location || '',\n    desired_location: body.desired_location || '',\n    price_text: body.price_text || '',",
  'profile create desired location',
);
server = replaceOnce(
  server,
  "    voice_name: body.voice_name || 'alloy',\n    media: Array.isArray(body.media) ? body.media : [],\n    preset_name: body.preset_name || null,",
  "    voice_name: body.voice_name || 'alloy',\n    avatar_url: body.avatar_url || null,\n    media: Array.isArray(body.media) ? body.media.map(String).slice(0, 30) : [],\n    quick_replies: Array.isArray(body.quick_replies) ? body.quick_replies.map(String).slice(0, 30) : [],\n    preset_name: body.preset_name || null,",
  'profile create assets',
);
server = replaceOnce(
  server,
  "app.get('/api/conversations/:id/messages', async (request) => ({ data: await messages((request.params as any).id) }));",
  "app.get('/api/conversations/:id/messages', async (request) => ({ data: await messages((request.params as any).id) }));\n\napp.post('/api/conversations/:id/send-media', async (request, reply) => {\n  const id = (request.params as any).id;\n  const body: any = request.body || {};\n  const url = String(body.url || '').trim();\n  const caption = String(body.caption || '').trim().slice(0, 1000);\n  const c = (await conversations()).find((x) => x.id === id);\n  if (!c) return reply.code(404).send({ error: 'Chat nicht gefunden' });\n  if (c.state !== 'HUMAN_ACTIVE') return reply.code(409).send({ error: 'Chat muss zuerst übernommen werden' });\n  const profile = await getProfile(c.profile_id);\n  const allowedMedia = Array.isArray(profile.media) ? profile.media.map(String) : [];\n  if (!allowedMedia.includes(url)) return reply.code(400).send({ error: 'Bild gehört nicht zur Medienbibliothek dieses Profils' });\n  let parsed: URL;\n  try { parsed = new URL(url); } catch { return reply.code(400).send({ error: 'Ungültige Bild-URL' }); }\n  if (parsed.protocol !== 'https:') return reply.code(400).send({ error: 'Bilder müssen über HTTPS erreichbar sein' });\n  const sentId = await sendImageUrl(c.profile_id, c.wa_jid, url, caption);\n  await addMessage({ conversation_id: id, wa_message_id: sentId, direction: 'out', sender: 'human', kind: 'image', text: caption || null, media_url: url });\n  await updateConversation(id, { state: 'HUMAN_ACTIVE', unread_count: 0, last_message_preview: caption ? `🖼 ${caption.slice(0, 150)}` : '🖼 Bild', last_message_at: new Date().toISOString() });\n  return { ok: true, kind: 'image' };\n});",
  'profile media send route',
);
writeFileSync('src/server.ts', server);

let html = readFileSync('public/index.html', 'utf8');
html = replaceOnce(
  html,
  '.composer{min-height:62px;background:#202c33;padding:9px 11px;display:grid;grid-template-columns:minmax(0,1fr) auto;gap:7px;align-items:end}',
  '.composer{min-height:62px;background:#202c33;padding:9px 11px;display:grid;grid-template-columns:auto auto minmax(0,1fr) auto;gap:7px;align-items:end}',
  'composer profile tools layout',
);
html = replaceOnce(
  html,
  '.sendBtn{border:0;border-radius:50%;width:42px;height:42px;background:var(--green);color:#06271f;font-size:18px;font-weight:900}.sendBtn:disabled,.composer textarea:disabled{opacity:.5;cursor:not-allowed}',
  '.sendBtn{border:0;border-radius:50%;width:42px;height:42px;background:var(--green);color:#06271f;font-size:18px;font-weight:900}.sendBtn:disabled,.composer textarea:disabled,.composer .icon:disabled{opacity:.5;cursor:not-allowed}.assetList{display:grid;gap:8px}.assetButton{width:100%;border:1px solid var(--line);background:#182229;border-radius:10px;padding:10px;text-align:left}.assetButton img{width:72px;height:72px;object-fit:cover;border-radius:9px;vertical-align:middle;margin-right:10px}',
  'profile asset styles',
);
html = replaceOnce(
  html,
  '<footer class="composer"><textarea id="composer" rows="1" placeholder="Chat zuerst übernehmen" disabled></textarea><button class="sendBtn" onclick="sendMessage()" disabled>➤</button></footer>',
  '<footer class="composer"><button id="quickReplyBtn" class="icon" title="Schnellantworten" onclick="openQuickReplies()" disabled>⚡</button><button id="mediaBtn" class="icon" title="Profilbilder senden" onclick="openMediaPicker()" disabled>🖼</button><textarea id="composer" rows="1" placeholder="Chat zuerst übernehmen" disabled></textarea><button class="sendBtn" onclick="sendMessage()" disabled>➤</button></footer>',
  'profile asset composer buttons',
);
html = replaceOnce(
  html,
  '<div class="field"><label>Standort</label><input id="pLocation"></div><div class="field"><label>Preisinfo</label><input id="pPrice"></div>',
  '<div class="field"><label>Standort</label><input id="pLocation"></div><div class="field"><label>Wunschstandort / Einsatzgebiet</label><input id="pDesiredLocation" placeholder="z. B. Köln Innenstadt, max. 10 km"></div><div class="field"><label>Profilbild-URL</label><input id="pAvatar" placeholder="https://…"></div><div class="field"><label>Preisinfo</label><input id="pPrice"></div>',
  'complete profile identity fields',
);
html = replaceOnce(
  html,
  '<div class="field" style="margin-top:10px"><label>Medien-URLs · eine pro Zeile</label><textarea id="pMedia" placeholder="https://…"></textarea></div></div>',
  '<div class="field" style="margin-top:10px"><label>Vorgefertigte Antworten · eine pro Zeile</label><textarea id="pQuickReplies" placeholder="Hallo 😊\\nDer Preis beträgt …\\nHeute wäre noch …"></textarea></div><div class="field" style="margin-top:10px"><label>Bilder zum Senden · öffentliche HTTPS-URL, eine pro Zeile</label><textarea id="pMedia" placeholder="https://…"></textarea></div></div>',
  'quick replies and media library fields',
);
html = replaceOnce(
  html,
  '<div id="qrModal" class="modal">',
  '<div id="profileAssetsModal" class="modal"><div class="modalCard" style="max-width:560px"><div class="modalHead"><b id="assetsTitle">Profil-Inhalte</b><button class="icon" onclick="closeModal(\'profileAssetsModal\')">✕</button></div><div class="modalBody"><div id="assetsList" class="assetList"></div></div></div></div>\n<div id="qrModal" class="modal">',
  'profile assets modal',
);
html = replaceOnce(
  html,
  "document.querySelector('.sendBtn').disabled=!canWrite}",
  "document.querySelector('.sendBtn').disabled=!canWrite;$('quickReplyBtn').disabled=!canWrite;$('mediaBtn').disabled=!canWrite}",
  'profile tools ownership gate',
);
html = replaceOnce(
  html,
  "$('pMedia').value=Array.isArray(p.media)?p.media.join('\\n'):''}",
  "$('pMedia').value=Array.isArray(p.media)?p.media.join('\\n'):'';$('pQuickReplies').value=Array.isArray(p.quick_replies)?p.quick_replies.join('\\n'):'';$('pDesiredLocation').value=p.desired_location||'';$('pAvatar').value=p.avatar_url||''}",
  'complete profile fill',
);
html = replaceOnce(
  html,
  "media:$('pMedia').value.split(/\\n+/).map(x=>x.trim()).filter(Boolean)}}",
  "media:$('pMedia').value.split(/\\n+/).map(x=>x.trim()).filter(Boolean).slice(0,30),quick_replies:$('pQuickReplies').value.split(/\\n+/).map(x=>x.trim()).filter(Boolean).slice(0,30),desired_location:$('pDesiredLocation').value.trim(),avatar_url:$('pAvatar').value.trim()||null}}",
  'complete profile payload',
);
html = replaceOnce(
  html,
  "function renderProfileRows(){$('profileRows').innerHTML=state.profiles.map(p=>`<button class=\"profileManage\" onclick=\"closeModal('profilesModal');editProfile('${p.id}')\"><span class=\"avatar\">${esc(initials(p.name))}</span><span><b>${esc(p.name)}</b><br><small style=\"color:var(--muted)\">${esc(p.location||p.phone_label||'Nicht eingerichtet')} · ${esc(p.connection?.status||p.status||'offline')}</small></span><span>›</span></button>`).join('')||'<div class=\"emptyList\">Noch keine Profile</div>'}",
  "function renderProfileRows(){$('profileRows').innerHTML=state.profiles.map(p=>`<button class=\"profileManage\" onclick=\"closeModal('profilesModal');editProfile('${p.id}')\"><span class=\"avatar\">${p.avatar_url?`<img src=\"${esc(p.avatar_url)}\" alt=\"\" style=\"width:100%;height:100%;object-fit:cover\">`:esc(initials(p.name))}</span><span><b>${esc(p.name)}</b><br><small style=\"color:var(--muted)\">${esc(p.desired_location||p.location||p.phone_label||'Nicht eingerichtet')} · ${esc(p.connection?.status||p.status||'offline')}</small></span><span>›</span></button>`).join('')||'<div class=\"emptyList\">Noch keine Profile</div>'}",
  'profile list image and desired location',
);
html = replaceOnce(
  html,
  "async function sendMessage(){if(!state.currentChat)return;if(state.currentChat.state!=='HUMAN_ACTIVE')return toast('Chat zuerst übernehmen');const t=$('composer').value.trim();if(!t)return;",
  "function activeChatProfile(){return state.currentChat?profileBy(state.currentChat.profile_id):null}\nfunction openQuickReplies(){if(!state.currentChat||state.currentChat.state!=='HUMAN_ACTIVE')return toast('Chat zuerst übernehmen');const p=activeChatProfile();const items=Array.isArray(p?.quick_replies)?p.quick_replies:[];$('assetsTitle').textContent='⚡ Schnellantworten · '+(p?.name||'Profil');$('assetsList').innerHTML=items.length?items.map((t,i)=>`<button class=\"assetButton\" onclick=\"useQuickReply(${i})\">${esc(t)}</button>`).join(''):'<div class=\"notice\">Für dieses Profil sind noch keine Schnellantworten hinterlegt.</div>';$('profileAssetsModal').classList.add('open')}\nfunction useQuickReply(i){const p=activeChatProfile();const items=Array.isArray(p?.quick_replies)?p.quick_replies:[];if(!items[i])return;$('composer').value=items[i];closeModal('profileAssetsModal');$('composer').focus()}\nfunction openMediaPicker(){if(!state.currentChat||state.currentChat.state!=='HUMAN_ACTIVE')return toast('Chat zuerst übernehmen');const p=activeChatProfile();const items=Array.isArray(p?.media)?p.media:[];$('assetsTitle').textContent='🖼 Bilder · '+(p?.name||'Profil');$('assetsList').innerHTML=items.length?items.map((u,i)=>`<button class=\"assetButton\" onclick=\"sendProfileMedia(${i})\"><img src=\"${esc(u)}\" alt=\"Bild ${i+1}\"><span>Bild ${i+1} senden</span></button>`).join(''):'<div class=\"notice\">Für dieses Profil sind noch keine Bilder hinterlegt.</div>';$('profileAssetsModal').classList.add('open')}\nasync function sendProfileMedia(i){if(!state.currentChat||state.currentChat.state!=='HUMAN_ACTIVE')return toast('Chat zuerst übernehmen');const p=activeChatProfile();const items=Array.isArray(p?.media)?p.media:[];const url=items[i];if(!url)return;try{await api('/api/conversations/'+state.currentChat.id+'/send-media',{method:'POST',body:JSON.stringify({url})});closeModal('profileAssetsModal');await loadMessages();await load();toast('Bild gesendet')}catch(e){toast(e.message)}}\nasync function sendMessage(){if(!state.currentChat)return;if(state.currentChat.state!=='HUMAN_ACTIVE')return toast('Chat zuerst übernehmen');const t=$('composer').value.trim();if(!t)return;",
  'quick replies and profile media functions',
);
html = replaceOnce(
  html,
  "<div class=\"bubble\"><div>${esc(m.text||'['+m.kind+']')}</div><div class=\"bubbleMeta\">",
  "<div class=\"bubble\">${m.kind==='image'&&m.media_url?`<img src=\"${esc(m.media_url)}\" alt=\"Gesendetes Bild\" style=\"max-width:280px;width:100%;border-radius:7px;display:block;margin-bottom:${m.text?'6px':'0'}\">`:''}<div>${esc(m.text|| (m.kind==='image'?'':'['+m.kind+']'))}</div><div class=\"bubbleMeta\">",
  'image rendering in chat',
);
writeFileSync('public/index.html', html);

console.log('prepare-profile-complete: full profile, desired location, quick replies and media sending applied');
