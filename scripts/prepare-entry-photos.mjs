import { readFileSync, writeFileSync } from 'node:fs';

function replaceOnce(source, before, after, label) {
  if (source.includes(after)) return source;
  if (!source.includes(before)) throw new Error(`prepare-entry-photos: pattern missing: ${label}`);
  return source.replace(before, after);
}

let store = readFileSync('src/store.ts', 'utf8');
store = replaceOnce(
  store,
  "  share_location?: { label?: string | null; address: string; latitude: number; longitude: number } | null;\n  price_text?: string | null;",
  "  share_location?: { label?: string | null; address: string; latitude: number; longitude: number } | null;\n  entry_photos?: { door_url?: string | null; bell_url?: string | null } | null;\n  price_text?: string | null;",
  'profile entry photo type',
);
writeFileSync('src/store.ts', store);

let server = readFileSync('src/server.ts', 'utf8');
server = replaceOnce(
  server,
  "    'name', 'phone_label', 'location', 'desired_location', 'share_location', 'price_text', 'hours_text', 'avatar_url',\n",
  "    'name', 'phone_label', 'location', 'desired_location', 'share_location', 'entry_photos', 'price_text', 'hours_text', 'avatar_url',\n",
  'entry photos patch whitelist',
);
server = replaceOnce(
  server,
  "    share_location: body.share_location || null,\n    price_text: body.price_text || '',",
  "    share_location: body.share_location || null,\n    entry_photos: body.entry_photos || {},\n    price_text: body.price_text || '',",
  'entry photos create field',
);
server = replaceOnce(
  server,
  "app.post('/api/conversations/:id/send-location', async (request, reply) => {",
  "app.post('/api/conversations/:id/send-entry-photo', async (request, reply) => {\n  const id = (request.params as any).id;\n  const body: any = request.body || {};\n  const type = String(body.type || '');\n  if (!['door', 'bell'].includes(type)) return reply.code(400).send({ error: 'Ungültiger Fototyp' });\n  const c = (await conversations()).find((x) => x.id === id);\n  if (!c) return reply.code(404).send({ error: 'Chat nicht gefunden' });\n  if (c.state !== 'HUMAN_ACTIVE') return reply.code(409).send({ error: 'Chat muss zuerst übernommen werden' });\n  const profile = await getProfile(c.profile_id);\n  const photos: any = profile.entry_photos || {};\n  const url = String(type === 'door' ? photos.door_url || '' : photos.bell_url || '').trim();\n  if (!/^https:\\/\\//i.test(url)) return reply.code(400).send({ error: type === 'door' ? 'Kein gültiges Haustürfoto hinterlegt' : 'Kein gültiges Klingelfoto hinterlegt' });\n  const label = type === 'door' ? 'Haustür' : 'Klingel';\n  const sentId = await sendImageUrl(c.profile_id, c.wa_jid, url, label);\n  await addMessage({ conversation_id: id, wa_message_id: sentId, direction: 'out', sender: 'human', kind: 'image', media_url: url, text: label });\n  await updateConversation(id, { state: 'HUMAN_ACTIVE', unread_count: 0, last_message_preview: `🖼 ${label}`, last_message_at: new Date().toISOString() });\n  return { ok: true, kind: 'image', type };\n});\n\napp.post('/api/conversations/:id/send-location', async (request, reply) => {",
  'entry photo send route',
);
writeFileSync('src/server.ts', server);

let html = readFileSync('public/index.html', 'utf8');
html = replaceOnce(
  html,
  '</style>',
  `.entryPhotoGrid{display:grid;grid-template-columns:1fr 1fr;gap:12px}.entryPhotoBtn{border:1px solid var(--line);background:#182229;border-radius:12px;padding:10px;text-align:left;color:inherit}.entryPhotoBtn:disabled{opacity:.45;cursor:not-allowed}.entryPhotoBtn img{width:100%;aspect-ratio:4/3;object-fit:cover;border-radius:9px;display:block;margin-bottom:8px}@media(max-width:520px){.entryPhotoGrid{grid-template-columns:1fr}}</style>`,
  'entry photo CSS',
);
html = replaceOnce(
  html,
  '<button id="locationBtn" class="icon locationBtn" title="Wahladresse als Standort senden" aria-label="Wahladresse als Standort senden" onclick="sendProfileLocation()" disabled>📍</button><textarea id="composer"',
  '<button id="locationBtn" class="icon locationBtn" title="Wahladresse als Standort senden" aria-label="Wahladresse als Standort senden" onclick="sendProfileLocation()" disabled>📍</button><button id="entryPhotoBtn" class="icon composerMedia" title="Haustür- oder Klingelfoto senden" aria-label="Haustür- oder Klingelfoto senden" onclick="openEntryPhotoPicker()" disabled>🏠</button><textarea id="composer"',
  'entry photo composer button',
);
html = replaceOnce(
  html,
  '<div id="mediaModal" class="modal">',
  '<div id="entryPhotoModal" class="modal"><div class="modalCard"><div class="modalHead"><b>Ankunftsfoto senden</b><button class="icon" onclick="closeModal(\'entryPhotoModal\')">✕</button></div><div class="modalBody"><div id="entryPhotoGrid" class="entryPhotoGrid"></div></div></div></div>\n<div id="mediaModal" class="modal">',
  'entry photo picker modal',
);
html = replaceOnce(
  html,
  '<div class="field" style="margin-top:10px"><label>Bilder zum Senden · HTTPS-URL, eine pro Zeile</label><textarea id="pMedia" placeholder="https://…"></textarea></div>',
  '<div class="settingsGroup"><h3>Ankunftsfotos</h3><div class="field"><label>Haustürfoto · HTTPS-URL</label><input id="pDoorPhoto" placeholder="https://…"></div><div class="field" style="margin-top:8px"><label>Klingelfoto · HTTPS-URL</label><input id="pBellPhoto" placeholder="https://…"></div><div class="notice" style="margin-top:8px">Im übernommenen Chat öffnet 🏠 zwei feste Sendeoptionen: Haustür und Klingel.</div></div><div class="field" style="margin-top:10px"><label>Bilder zum Senden · HTTPS-URL, eine pro Zeile</label><textarea id="pMedia" placeholder="https://…"></textarea></div>',
  'entry photo profile fields',
);
html = replaceOnce(
  html,
  "$('pShareLng').value=Number.isFinite(Number(sl.longitude))?String(sl.longitude):''}",
  "$('pShareLng').value=Number.isFinite(Number(sl.longitude))?String(sl.longitude):'';const ep=p.entry_photos||{};$('pDoorPhoto').value=ep.door_url||'';$('pBellPhoto').value=ep.bell_url||''}",
  'entry photo profile fill',
);
html = replaceOnce(
  html,
  "return{label:$('pShareLabel').value.trim()||null,address,latitude,longitude}})()}}",
  "return{label:$('pShareLabel').value.trim()||null,address,latitude,longitude}})(),entry_photos:{door_url:$('pDoorPhoto').value.trim()||null,bell_url:$('pBellPhoto').value.trim()||null}}}",
  'entry photo profile payload',
);
html = replaceOnce(
  html,
  "if($('pShareAddress').value.trim()&&!payload.share_location)return toast('Für die Wahladresse fehlen gültige Koordinaten');",
  "if($('pShareAddress').value.trim()&&!payload.share_location)return toast('Für die Wahladresse fehlen gültige Koordinaten');for(const [label,url] of [['Haustürfoto',payload.entry_photos?.door_url],['Klingelfoto',payload.entry_photos?.bell_url]]){if(url&&!/^https:\\/\\//i.test(url))return toast(label+' muss eine HTTPS-URL sein')}",
  'entry photo form validation',
);
html = replaceOnce(
  html,
  "$('locationBtn').disabled=!canWrite;renderQuickBar()}",
  "$('locationBtn').disabled=!canWrite;$('entryPhotoBtn').disabled=!canWrite;renderQuickBar()}",
  'entry photo ownership state',
);
html = replaceOnce(
  html,
  'async function sendProfileLocation(){',
  "function openEntryPhotoPicker(){const c=state.currentChat;if(!c||c.state!=='HUMAN_ACTIVE')return toast('Chat zuerst übernehmen');const p=profileBy(c.profile_id);const ep=p?.entry_photos||{};const options=[['door','Haustür',ep.door_url,'🚪'],['bell','Klingel',ep.bell_url,'🔔']];$('entryPhotoGrid').innerHTML=options.map(([type,label,url,icon])=>{const valid=typeof url==='string'&&/^https:\\/\\//i.test(url);return '<button class=\"entryPhotoBtn\" '+(valid?'':'disabled')+' onclick=\"sendEntryPhoto(\\''+type+'\\')\">'+(valid?'<img src=\"'+esc(url)+'\" alt=\"'+esc(label)+'\">':'')+'<b>'+icon+' '+esc(label)+'</b><div style=\"margin-top:4px;color:var(--muted);font-size:12px\">'+(valid?'Foto senden':'Noch kein Foto hinterlegt')+'</div></button>'}).join('');$('entryPhotoModal').classList.add('open')}\nasync function sendEntryPhoto(type){const c=state.currentChat;if(!c||c.state!=='HUMAN_ACTIVE')return toast('Chat zuerst übernehmen');try{await api('/api/conversations/'+c.id+'/send-entry-photo',{method:'POST',body:JSON.stringify({type})});closeModal('entryPhotoModal');await loadMessages(c.id);await load();toast(type==='door'?'Haustürfoto gesendet':'Klingelfoto gesendet')}catch(e){toast(e.message)}}\nasync function sendProfileLocation(){",
  'entry photo actions',
);
writeFileSync('public/index.html', html);

console.log('prepare-entry-photos: dedicated door and bell photo workflow applied');
