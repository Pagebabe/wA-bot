import { readFileSync, writeFileSync } from 'node:fs';

function replaceOnce(source, before, after, label) {
  if (source.includes(after)) return source;
  if (!source.includes(before)) throw new Error(`prepare-location-share: pattern missing: ${label}`);
  return source.replace(before, after);
}

let store = readFileSync('src/store.ts', 'utf8');
store = replaceOnce(
  store,
  "  desired_location?: string | null;\n  price_text?: string | null;",
  "  desired_location?: string | null;\n  share_location?: { label?: string | null; address: string; latitude: number; longitude: number } | null;\n  price_text?: string | null;",
  'profile share location type',
);
store = replaceOnce(
  store,
  "  kind: 'text' | 'voice' | 'image' | 'system';",
  "  kind: 'text' | 'voice' | 'image' | 'location' | 'system';",
  'message location kind',
);
writeFileSync('src/store.ts', store);

let wa = readFileSync('src/whatsapp.ts', 'utf8');
wa = replaceOnce(
  wa,
  "export async function sendVoiceAudio(profileId: string, jid: string, audio: Buffer) {",
  "export async function sendLocation(profileId: string, jid: string, latitude: number, longitude: number, label: string, address: string) {\n  const session = sessions.get(profileId);\n  if (!session?.socket || session.status !== 'online') throw new Error('WhatsApp profile is not online');\n  if (!Number.isFinite(latitude) || latitude < -90 || latitude > 90) throw new Error('Invalid latitude');\n  if (!Number.isFinite(longitude) || longitude < -180 || longitude > 180) throw new Error('Invalid longitude');\n  const sent = await session.socket.sendMessage(jid, { location: { degreesLatitude: latitude, degreesLongitude: longitude, name: label.trim() || address.trim(), address: address.trim() } });\n  return sent?.key?.id || null;\n}\n\nexport async function sendVoiceAudio(profileId: string, jid: string, audio: Buffer) {",
  'native WhatsApp location sender',
);
writeFileSync('src/whatsapp.ts', wa);

let server = readFileSync('src/server.ts', 'utf8');
server = replaceOnce(
  server,
  "  sendText,\n  sendImageUrl,\n  sendVoiceAudio,",
  "  sendText,\n  sendImageUrl,\n  sendLocation,\n  sendVoiceAudio,",
  'location sender import',
);
server = replaceOnce(
  server,
  "    'name', 'phone_label', 'location', 'desired_location', 'price_text', 'hours_text', 'avatar_url',\n",
  "    'name', 'phone_label', 'location', 'desired_location', 'share_location', 'price_text', 'hours_text', 'avatar_url',\n",
  'share location patch whitelist',
);
server = replaceOnce(
  server,
  "    desired_location: body.desired_location || '',\n    price_text: body.price_text || '',",
  "    desired_location: body.desired_location || '',\n    share_location: body.share_location || null,\n    price_text: body.price_text || '',",
  'share location create field',
);
server = replaceOnce(
  server,
  "app.post('/api/conversations/:id/send-media', async (request, reply) => {",
  "app.post('/api/conversations/:id/send-location', async (request, reply) => {\n  const id = (request.params as any).id;\n  const c = (await conversations()).find((x) => x.id === id);\n  if (!c) return reply.code(404).send({ error: 'Chat nicht gefunden' });\n  if (c.state !== 'HUMAN_ACTIVE') return reply.code(409).send({ error: 'Chat muss zuerst übernommen werden' });\n  const profile = await getProfile(c.profile_id);\n  const loc: any = profile.share_location;\n  const latitude = Number(loc?.latitude);\n  const longitude = Number(loc?.longitude);\n  const address = String(loc?.address || '').trim();\n  const label = String(loc?.label || profile.name || address).trim();\n  if (!address || !Number.isFinite(latitude) || latitude < -90 || latitude > 90 || !Number.isFinite(longitude) || longitude < -180 || longitude > 180) {\n    return reply.code(400).send({ error: 'Für dieses Profil ist keine gültige Wahladresse mit Koordinaten hinterlegt' });\n  }\n  const sentId = await sendLocation(c.profile_id, c.wa_jid, latitude, longitude, label, address);\n  await addMessage({ conversation_id: id, wa_message_id: sentId, direction: 'out', sender: 'human', kind: 'location', text: `📍 ${label}${label !== address ? ` · ${address}` : ''}` });\n  await updateConversation(id, { state: 'HUMAN_ACTIVE', unread_count: 0, last_message_preview: `📍 ${address}`.slice(0, 180), last_message_at: new Date().toISOString() });\n  return { ok: true, kind: 'location' };\n});\n\napp.post('/api/conversations/:id/send-media', async (request, reply) => {",
  'profile location send route',
);
writeFileSync('src/server.ts', server);

let html = readFileSync('public/index.html', 'utf8');
html = replaceOnce(
  html,
  '</style>',
  `.composer{grid-template-columns:auto auto minmax(0,1fr) auto}.locationBtn:disabled{opacity:.45;cursor:not-allowed}.shareLocationGrid{display:grid;grid-template-columns:1fr 1fr;gap:10px}@media(max-width:900px){.shareLocationGrid{grid-template-columns:1fr}}</style>`,
  'location share CSS',
);
html = replaceOnce(
  html,
  '<button id="mediaBtn" class="icon composerMedia" title="Profilbilder senden" aria-label="Profilbilder senden" onclick="openMediaPicker()" disabled>🖼</button><textarea id="composer"',
  '<button id="mediaBtn" class="icon composerMedia" title="Profilbilder senden" aria-label="Profilbilder senden" onclick="openMediaPicker()" disabled>🖼</button><button id="locationBtn" class="icon locationBtn" title="Wahladresse als Standort senden" aria-label="Wahladresse als Standort senden" onclick="sendProfileLocation()" disabled>📍</button><textarea id="composer"',
  'location composer button',
);
html = replaceOnce(
  html,
  '<div class="field" style="margin-top:10px"><label>Schnellantworten · eine pro Zeile</label>',
  '<div class="settingsGroup"><h3>Wahladresse als WhatsApp-Standort</h3><div class="field"><label>Name des Standorts</label><input id="pShareLabel" placeholder="z. B. Studio Köln"></div><div class="field" style="margin-top:8px"><label>Adresse</label><input id="pShareAddress" placeholder="Straße Hausnr., PLZ Ort"></div><div class="shareLocationGrid" style="margin-top:8px"><div class="field"><label>Breitengrad</label><input id="pShareLat" type="number" step="any" min="-90" max="90" placeholder="50.9375"></div><div class="field"><label>Längengrad</label><input id="pShareLng" type="number" step="any" min="-180" max="180" placeholder="6.9603"></div></div><div class="notice" style="margin-top:8px">Diese Adresse wird als echter WhatsApp-Standort gesendet; sie ist unabhängig vom aktuellen Handy-GPS.</div></div><div class="field" style="margin-top:10px"><label>Schnellantworten · eine pro Zeile</label>',
  'share location profile controls',
);
html = replaceOnce(
  html,
  "$('pAvatar').value=p.avatar_url||'';$('pQuick').value=Array.isArray(p.quick_replies)?p.quick_replies.join('\\n'):'';$('pDesiredLocation').value=p.desired_location||''}",
  "$('pAvatar').value=p.avatar_url||'';$('pQuick').value=Array.isArray(p.quick_replies)?p.quick_replies.join('\\n'):'';$('pDesiredLocation').value=p.desired_location||'';const sl=p.share_location||{};$('pShareLabel').value=sl.label||'';$('pShareAddress').value=sl.address||'';$('pShareLat').value=Number.isFinite(Number(sl.latitude))?String(sl.latitude):'';$('pShareLng').value=Number.isFinite(Number(sl.longitude))?String(sl.longitude):''}",
  'share location profile fill',
);
html = replaceOnce(
  html,
  "quick_replies:$('pQuick').value.split(/\\n+/).map(x=>x.trim()).filter(Boolean),desired_location:$('pDesiredLocation').value.trim()}}",
  "quick_replies:$('pQuick').value.split(/\\n+/).map(x=>x.trim()).filter(Boolean),desired_location:$('pDesiredLocation').value.trim(),share_location:(()=>{const address=$('pShareAddress').value.trim();if(!address)return null;const latitude=Number($('pShareLat').value),longitude=Number($('pShareLng').value);if(!Number.isFinite(latitude)||!Number.isFinite(longitude))return null;return{label:$('pShareLabel').value.trim()||null,address,latitude,longitude}})()}}",
  'share location profile payload',
);
html = replaceOnce(
  html,
  "async function saveProfile(){const payload=profilePayload();if(!payload.name)return toast('Name fehlt');",
  "async function saveProfile(){const payload=profilePayload();if(!payload.name)return toast('Name fehlt');if($('pShareAddress').value.trim()&&!payload.share_location)return toast('Für die Wahladresse fehlen gültige Koordinaten');",
  'share location form validation',
);
html = replaceOnce(
  html,
  "$('mediaBtn').disabled=!canWrite;renderQuickBar()}",
  "$('mediaBtn').disabled=!canWrite;$('locationBtn').disabled=!canWrite;renderQuickBar()}",
  'location ownership state',
);
html = replaceOnce(
  html,
  'function openMediaPicker(){',
  "async function sendProfileLocation(){const c=state.currentChat;if(!c||c.state!=='HUMAN_ACTIVE')return toast('Chat zuerst übernehmen');const p=profileBy(c.profile_id);if(!p?.share_location?.address)return toast('Für dieses Profil ist keine Wahladresse hinterlegt');try{await api('/api/conversations/'+c.id+'/send-location',{method:'POST',body:'{}'});await loadMessages(c.id);await load();toast('Standort gesendet')}catch(e){toast(e.message)}}\nfunction openMediaPicker(){",
  'location send action',
);
writeFileSync('public/index.html', html);

console.log('prepare-location-share: per-profile native WhatsApp location sharing applied');
