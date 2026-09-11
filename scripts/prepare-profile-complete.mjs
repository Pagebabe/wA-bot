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
writeFileSync('src/store.ts', store);

let ai = readFileSync('src/ai.ts', 'utf8');
ai = replaceOnce(
  ai,
  "    profile.location ? `Ort: ${profile.location}` : '',\n    profile.price_text ? `Preise: ${profile.price_text}` : '',",
  "    profile.location ? `Ort: ${profile.location}` : '',\n    profile.desired_location ? `Wunschstandort / Einsatzgebiet: ${profile.desired_location}` : '',\n    profile.price_text ? `Preise: ${profile.price_text}` : '',",
  'desired location in AI context',
);
writeFileSync('src/ai.ts', ai);

let server = readFileSync('src/server.ts', 'utf8');
server = replaceOnce(
  server,
  "    'name', 'phone_label', 'location', 'price_text', 'hours_text', 'avatar_url',\n",
  "    'name', 'phone_label', 'location', 'desired_location', 'price_text', 'hours_text', 'avatar_url',\n",
  'desired location patch whitelist',
);
server = replaceOnce(
  server,
  "    location: body.location || '',\n    price_text: body.price_text || '',",
  "    location: body.location || '',\n    desired_location: body.desired_location || '',\n    price_text: body.price_text || '',",
  'desired location create field',
);
writeFileSync('src/server.ts', server);

let html = readFileSync('public/index.html', 'utf8');
html = replaceOnce(
  html,
  '<div class="field"><label>Standort</label><input id="pLocation"></div><div class="field"><label>Preisinfo</label><input id="pPrice"></div>',
  '<div class="field"><label>Standort</label><input id="pLocation"></div><div class="field"><label>Wunschstandort / Einsatzgebiet</label><input id="pDesiredLocation" placeholder="z. B. Köln Innenstadt, max. 10 km"></div><div class="field"><label>Preisinfo</label><input id="pPrice"></div>',
  'desired location form field',
);
html = replaceOnce(
  html,
  "$('pAvatar').value=p.avatar_url||'';$('pQuick').value=Array.isArray(p.quick_replies)?p.quick_replies.join('\\n'):''}",
  "$('pAvatar').value=p.avatar_url||'';$('pQuick').value=Array.isArray(p.quick_replies)?p.quick_replies.join('\\n'):'';$('pDesiredLocation').value=p.desired_location||''}",
  'desired location form fill',
);
html = replaceOnce(
  html,
  "quick_replies:$('pQuick').value.split(/\\n+/).map(x=>x.trim()).filter(Boolean)}}",
  "quick_replies:$('pQuick').value.split(/\\n+/).map(x=>x.trim()).filter(Boolean),desired_location:$('pDesiredLocation').value.trim()}}",
  'desired location form payload',
);
html = replaceOnce(
  html,
  "${esc(p.location||p.phone_label||'Nicht eingerichtet')} · ${esc(p.connection?.status||p.status||'offline')}",
  "${esc(p.desired_location||p.location||p.phone_label||'Nicht eingerichtet')} · ${esc(p.connection?.status||p.status||'offline')}",
  'desired location profile summary',
);
html = replaceOnce(
  html,
  "<div class=\"bubble\"><div>${esc(m.text||'['+m.kind+']')}</div><div class=\"bubbleMeta\">",
  "<div class=\"bubble\">${m.kind==='image'&&m.media_url?`<img src=\"${esc(m.media_url)}\" alt=\"Gesendetes Bild\" style=\"max-width:280px;width:100%;border-radius:7px;display:block;margin-bottom:6px\">`:''}<div>${esc(m.text|| (m.kind==='image'?'':'['+m.kind+']'))}</div><div class=\"bubbleMeta\">",
  'image messages render as images',
);
writeFileSync('public/index.html', html);

console.log('prepare-profile-complete: desired location and image rendering applied');
