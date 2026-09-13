import { readFileSync, writeFileSync } from 'node:fs';

function replaceRequired(source, before, after, label) {
  if (source.includes(after)) return source;
  if (!source.includes(before)) throw new Error(`prepare-whatsapp-identity: pattern missing: ${label}`);
  return source.replace(before, after);
}

let wa = readFileSync('src/whatsapp.ts', 'utf8');

wa = replaceRequired(
  wa,
  "  status: 'offline' | 'connecting' | 'online' | 'error';\n  reconnecting: boolean;",
  "  status: 'offline' | 'connecting' | 'online' | 'error';\n  account: { id: string; number: string | null; name: string | null } | null;\n  reconnecting: boolean;",
  'session account field',
);

wa = replaceRequired(
  wa,
  "let voiceTranscriber: ((audio: Buffer, mime: string) => Promise<string>) | null = null;",
  "let voiceTranscriber: ((audio: Buffer, mime: string) => Promise<string>) | null = null;\n\nfunction accountFromUser(user: any) {\n  const id = typeof user?.id === 'string' ? user.id.trim() : '';\n  if (!id) return null;\n  const bare = id.split('@')[0].split(':')[0];\n  const digits = bare.replace(/\\D/g, '');\n  const name = typeof user?.name === 'string' && user.name.trim() ? user.name.trim() : null;\n  return { id, number: digits ? `+${digits}` : null, name };\n}",
  'account parser',
);

wa = replaceRequired(
  wa,
  "  const session: Session = { socket: null, qrDataUrl: null, status: 'connecting', reconnecting: false };",
  "  const session: Session = { socket: null, qrDataUrl: null, status: 'connecting', account: accountFromUser(state.creds?.me), reconnecting: false };",
  'seed account from credentials',
);

wa = replaceRequired(
  wa,
  "    if (update.connection === 'open') {\n      session.qrDataUrl = null;\n      session.status = 'online';\n      session.reconnecting = false;",
  "    if (update.connection === 'open') {\n      session.qrDataUrl = null;\n      session.status = 'online';\n      session.account = accountFromUser(socket.user) || accountFromUser(state.creds?.me) || session.account;\n      session.reconnecting = false;",
  'refresh account on connection open',
);

wa = replaceRequired(
  wa,
  "  return session ? { status: session.status, qr: session.qrDataUrl } : { status: 'offline', qr: null };",
  "  return session ? { status: session.status, qr: session.qrDataUrl, account: session.account } : { status: 'offline', qr: null, account: null };",
  'expose account in connection state',
);

writeFileSync('src/whatsapp.ts', wa);

let html = readFileSync('public/index.html', 'utf8');

html = replaceRequired(
  html,
  "function renderProfileSelect(){const sel=$('profileSelect');const value=state.selectedProfile;sel.innerHTML='<option value=\"\">Alle Profile</option>'+state.profiles.map(p=>`<option value=\"${p.id}\">${esc(p.name)} · ${esc(p.connection?.status||p.status||'offline')}</option>`).join('');sel.value=value;const p=profileBy(value);$('profileDot').className='connDot '+(p?.connection?.status||p?.status||'')}",
  "function waAccountLabel(p){const a=p?.connection?.account;return a?.number?`${a.number}${a.name?' · '+a.name:''}`:''}\nfunction renderProfileSelect(){const sel=$('profileSelect');const value=state.selectedProfile;sel.innerHTML='<option value=\"\">Alle Profile</option>'+state.profiles.map(p=>`<option value=\"${p.id}\">${esc(p.name)} · ${esc(waAccountLabel(p)||p.connection?.status||p.status||'offline')}</option>`).join('');sel.value=value;const p=profileBy(value);$('profileDot').className='connDot '+(p?.connection?.status||p?.status||'')}",
  'profile selector account identity',
);

html = replaceRequired(
  html,
  "${esc(p.desired_location||p.location||p.phone_label||'Nicht eingerichtet')} · ${esc(p.connection?.status||p.status||'offline')}",
  "${esc(waAccountLabel(p)||p.desired_location||p.location||p.phone_label||'Nicht eingerichtet')} · ${esc(p.connection?.status||p.status||'offline')}",
  'profile list account identity',
);

html = replaceRequired(
  html,
  "function editProfile(id){const p=profileBy(id);if(!p)return;state.editingProfile=id;fillProfile(p);$('profileModalTitle').textContent=p.name;$('connectBox').style.display='block';$('connectStatus').textContent='Status: '+(p.connection?.status||p.status||'offline');$('profileModal').classList.add('open')}",
  "function editProfile(id){const p=profileBy(id);if(!p)return;state.editingProfile=id;fillProfile(p);$('profileModalTitle').textContent=p.name;$('connectBox').style.display='block';const account=waAccountLabel(p),status=p.connection?.status||p.status||'offline';$('connectStatus').textContent=account?'Verbundenes WhatsApp: '+account+' · Status: '+status:'Status: '+status;$('profileModal').classList.add('open')}",
  'profile modal account identity',
);

writeFileSync('public/index.html', html);
console.log('prepare-whatsapp-identity: linked WhatsApp number and account name exposed in profile UI');
