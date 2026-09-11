import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { chromium } from 'playwright-core';

const html = readFileSync('public/index.html', 'utf8');
const now = () => new Date().toISOString();
let profileSeq = 2;
let convSeq = 3;
let profiles;
let conversations;
let messages;
let settings;

function resetState() {
  profiles = [{
    id: 'p1', name: 'Köln Profil', phone_label: 'Köln 1', location: 'Köln', price_text: 'ab 80 €', hours_text: '10–22',
    status: 'offline', connection: { status: 'offline', qr: null }, bot_enabled: true,
    system_prompt: 'Qualifiziere kurz.', qualification_prompt: 'Terminbereit ist HOT.', hot_threshold: .8,
    response_style: 'kurz', max_ai_turns: 8, handoff_behavior: 'stop', voice_mode: 'off', llm_model_override: null,
    temperature: .35, voice_name: 'alloy', media: [],
  }];
  conversations = [
    { id: 'c-hot', profile_id: 'p1', wa_jid: '49111@s.whatsapp.net', contact_name: 'Anna Hot', state: 'HOT', hot_score: .94, hot_reason: 'Terminbereit', ai_turns: 2, unread_count: 2, last_message_preview: 'Heute passt.', last_message_at: now() },
    { id: 'c-ai', profile_id: 'p1', wa_jid: '49222@s.whatsapp.net', contact_name: 'Ben KI', state: 'AI_ACTIVE', hot_score: null, hot_reason: null, ai_turns: 1, unread_count: 0, last_message_preview: 'Was kostet es?', last_message_at: new Date(Date.now()-60000).toISOString() },
  ];
  messages = {
    'c-hot': [{ id:'m1', conversation_id:'c-hot', direction:'in', sender:'lead', kind:'text', text:'Heute passt.', created_at:now() }],
    'c-ai': [{ id:'m2', conversation_id:'c-ai', direction:'in', sender:'lead', kind:'text', text:'Was kostet es?', created_at:now() }],
  };
  settings = { app_name:'wA-bot', llm_base_url:'https://integrate.api.nvidia.com', llm_model:'test-model', has_llm_key:true, voice_enabled:false, voice_provider:'same-api', voice_model:'tts', ai_disclosure_enabled:true };
}

function bodyJson(req) {
  return new Promise((resolve) => { let data=''; req.on('data', c => data += c); req.on('end', () => { try { resolve(data ? JSON.parse(data) : {}); } catch { resolve({}); } }); });
}
function json(res, status, value) { res.writeHead(status, {'content-type':'application/json'}); res.end(JSON.stringify(value)); }

async function startMock() {
  resetState();
  const server = createServer(async (req, res) => {
    const url = new URL(req.url, 'http://127.0.0.1');
    const path = url.pathname;
    if (path === '/' && req.method === 'GET') { res.writeHead(200, {'content-type':'text/html; charset=utf-8'}); return res.end(html); }
    if (path === '/api/bootstrap' && req.method === 'GET') return json(res, 200, { profiles, conversations, settings });
    if (path === '/api/settings/test' && req.method === 'POST') return json(res, 200, { ok:true, status:200, text:'OK' });
    if (path === '/api/settings' && req.method === 'POST') { const b=await bodyJson(req); settings={...settings,...b,has_llm_key:true}; return json(res,200,{ok:true,settings}); }
    if (path === '/api/demo/hot' && req.method === 'POST') { const id=`c-demo-${convSeq++}`; conversations.unshift({id,profile_id:'p1',wa_jid:`demo${convSeq}@s.whatsapp.net`,contact_name:'Demo Lead',state:'HOT',hot_score:.95,hot_reason:'Demo HOT',ai_turns:1,unread_count:1,last_message_preview:'Termin heute?',last_message_at:now()}); messages[id]=[{id:`m-${id}`,conversation_id:id,direction:'in',sender:'lead',kind:'text',text:'Termin heute?',created_at:now()}]; return json(res,200,{ok:true,id}); }
    if (path === '/api/profiles' && req.method === 'POST') { const b=await bodyJson(req); const p={...profiles[0],...b,id:`p${profileSeq++}`,status:'offline',connection:{status:'offline',qr:null}}; profiles.push(p); return json(res,201,p); }
    const profileMatch = path.match(/^\/api\/profiles\/([^/]+)$/);
    if (profileMatch && req.method === 'PATCH') { const p=profiles.find(x=>x.id===profileMatch[1]); if(!p)return json(res,404,{error:'not_found'}); Object.assign(p,await bodyJson(req)); return json(res,200,p); }
    if (profileMatch && req.method === 'DELETE') { profiles=profiles.filter(x=>x.id!==profileMatch[1]); conversations=conversations.filter(x=>x.profile_id!==profileMatch[1]); return json(res,200,{ok:true}); }
    const cloneMatch=path.match(/^\/api\/profiles\/([^/]+)\/clone$/);
    if(cloneMatch&&req.method==='POST'){const p=profiles.find(x=>x.id===cloneMatch[1]);const copy={...p,id:`p${profileSeq++}`,name:`${p.name} Kopie`,connection:{status:'offline',qr:null}};profiles.push(copy);return json(res,200,copy);}
    const connectMatch=path.match(/^\/api\/profiles\/([^/]+)\/connect$/);
    if(connectMatch&&req.method==='POST'){const p=profiles.find(x=>x.id===connectMatch[1]);p.connection={status:'connecting',qr:null};return json(res,200,p.connection);}
    const connectionMatch=path.match(/^\/api\/profiles\/([^/]+)\/connection$/);
    if(connectionMatch&&req.method==='GET'){const p=profiles.find(x=>x.id===connectionMatch[1]);p.connection={status:'connecting',qr:'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9ZQmcAAAAASUVORK5CYII='};return json(res,200,p.connection);}
    const unlinkMatch=path.match(/^\/api\/profiles\/([^/]+)\/unlink$/);
    if(unlinkMatch&&req.method==='POST'){const p=profiles.find(x=>x.id===unlinkMatch[1]);p.connection={status:'offline',qr:null};return json(res,200,{ok:true});}
    const msgMatch=path.match(/^\/api\/conversations\/([^/]+)\/messages$/);
    if(msgMatch&&req.method==='GET')return json(res,200,{data:messages[msgMatch[1]]||[]});
    const actionMatch=path.match(/^\/api\/conversations\/([^/]+)\/(takeover|return-ai|close|send)$/);
    if(actionMatch&&req.method==='POST'){
      const c=conversations.find(x=>x.id===actionMatch[1]); if(!c)return json(res,404,{error:'not_found'});
      if(actionMatch[2]==='takeover')c.state='HUMAN_ACTIVE';
      if(actionMatch[2]==='return-ai')c.state='AI_ACTIVE';
      if(actionMatch[2]==='close')c.state='CLOSED';
      if(actionMatch[2]==='send'){if(c.state!=='HUMAN_ACTIVE')return json(res,409,{error:'Chat muss zuerst übernommen werden'});const b=await bodyJson(req);(messages[c.id]??=[]).push({id:`m${Date.now()}`,conversation_id:c.id,direction:'out',sender:'human',kind:'text',text:b.text,created_at:now()});c.last_message_preview=b.text;}
      return json(res,200,actionMatch[2]==='send'?{ok:true}:c);
    }
    json(res,404,{error:'not_found'});
  });
  await new Promise(resolve => server.listen(0,'127.0.0.1',resolve));
  const {port}=server.address();
  return { server, base:`http://127.0.0.1:${port}` };
}

async function launchPage(base, viewport) {
  const executablePath = process.env.CHROMIUM_PATH || '/usr/bin/chromium-browser';
  const browser = await chromium.launch({ executablePath, headless:true, args:['--no-sandbox','--disable-dev-shm-usage'] });
  const page = await browser.newPage({ viewport });
  const consoleErrors=[]; const pageErrors=[]; const failed=[];
  page.on('console', msg => { if(msg.type()==='error') consoleErrors.push(msg.text()); });
  page.on('pageerror', err => pageErrors.push(err.message));
  page.on('requestfailed', req => failed.push(`${req.method()} ${req.url()} ${req.failure()?.errorText||''}`));
  page.on('dialog', d => d.accept());
  await page.goto(base+'/', {waitUntil:'networkidle'});
  return {browser,page,consoleErrors,pageErrors,failed};
}

async function noRuntimeErrors(ctx) {
  await ctx.page.waitForTimeout(100);
  assert.deepEqual(ctx.pageErrors, [], `page errors: ${ctx.pageErrors.join(' | ')}`);
  assert.deepEqual(ctx.consoleErrors, [], `console errors: ${ctx.consoleErrors.join(' | ')}`);
  assert.deepEqual(ctx.failed, [], `failed requests: ${ctx.failed.join(' | ')}`);
}

async function clickAndVisible(page, selector, visibleSelector) {
  await page.locator(selector).click();
  await expectVisible(page, visibleSelector);
}
async function expectVisible(page, selector) { assert.equal(await page.locator(selector).isVisible(), true, `${selector} should be visible`); }

for (const cfg of [
  {name:'desktop', viewport:{width:1440,height:900}},
  {name:'mobile', viewport:{width:390,height:844}},
]) {
  test(`real browser ${cfg.name}: navigation, filters, search and modals`, async () => {
    const mock=await startMock(); const ctx=await launchPage(mock.base,cfg.viewport); const {page,browser}=ctx;
    try {
      await expectVisible(page,'#chatList');
      await page.locator('#fUnread').click(); assert.equal(await page.locator('#fUnread').evaluate(e=>e.classList.contains('active')),true);
      await page.locator('#fHot').click(); assert.equal(await page.locator('#fHot').evaluate(e=>e.classList.contains('active')),true);
      await page.locator('#fMine').click(); await page.locator('#fAi').click(); await page.locator('#fAll').click();
      await page.locator('#search').fill('Anna'); assert.equal(await page.locator('.chatRow').count(),1); await page.locator('#search').fill('');
      await page.locator('#profileSelect').selectOption('p1'); assert.equal(await page.locator('#profileSelect').inputValue(),'p1'); await page.locator('#profileSelect').selectOption('');
      await page.getByTitle('Einstellungen').first().click(); await expectVisible(page,'#settingsModal'); await page.locator('#settingsModal .modalHead button').click();
      await page.getByTitle('Profile verwalten').click(); await expectVisible(page,'#profilesModal'); await page.locator('#profilesModal .modalHead button').click();
      await noRuntimeErrors(ctx);
      const overflow=await page.evaluate(()=>document.documentElement.scrollWidth-window.innerWidth); assert.ok(overflow<=1,`horizontal overflow ${overflow}px`);
    } finally { await browser.close(); await new Promise(r=>mock.server.close(r)); }
  });
}

test('real browser: profile create/edit/clone/QR/unlink/delete buttons', async () => {
  const mock=await startMock(); const ctx=await launchPage(mock.base,{width:1440,height:900}); const {page,browser}=ctx;
  try {
    await page.getByTitle('Profil hinzufügen').click(); await expectVisible(page,'#profileModal');
    await page.locator('#pName').fill('Smoke Profil'); await page.locator('#pLocation').fill('Bonn'); await page.locator('#pModel').fill('override-model'); await page.locator('#pTemp').fill('0.4'); await page.locator('#pVoiceName').fill('alloy'); await page.locator('#pMedia').fill('https://example.com/a.jpg');
    await page.getByRole('button',{name:'Speichern'}).click(); await page.waitForTimeout(80);
    await page.getByTitle('Profile verwalten').click(); await page.getByText('Smoke Profil',{exact:false}).click(); await expectVisible(page,'#profileModal');
    await page.getByRole('button',{name:'Profil kopieren'}).click(); await page.waitForTimeout(80);
    await page.getByTitle('Profile verwalten').click(); await page.getByText('Smoke Profil',{exact:false}).first().click();
    await page.getByRole('button',{name:'QR koppeln'}).click(); await expectVisible(page,'#qrModal'); await page.waitForTimeout(1700); await expectVisible(page,'#qrImage'); await page.locator('#qrModal .modalHead button').click();
    await page.getByRole('button',{name:'Verknüpfung lösen'}).click(); await page.waitForTimeout(80);
    await page.getByRole('button',{name:'Profil löschen'}).click(); await page.waitForTimeout(80); assert.equal(await page.locator('#profileModal').isVisible(),false);
    await noRuntimeErrors(ctx);
  } finally { await browser.close(); await new Promise(r=>mock.server.close(r)); }
});

test('real browser: HOT takeover, composer, return-to-AI and close', async () => {
  const mock=await startMock(); const ctx=await launchPage(mock.base,{width:1440,height:900}); const {page,browser}=ctx;
  try {
    await page.getByText('Anna Hot',{exact:true}).click(); await expectVisible(page,'#chatView');
    assert.equal(await page.locator('#composer').isDisabled(),true);
    await page.getByRole('button',{name:'Übernehmen'}).first().click(); await page.waitForTimeout(80); assert.equal(await page.locator('#composer').isDisabled(),false);
    await page.locator('#composer').fill('Testantwort'); await page.locator('.sendBtn').click(); await page.waitForTimeout(80); assert.ok(await page.locator('#messages').textContent().then(t=>t.includes('Testantwort')));
    await page.getByTitle('Zur KI zurück').click(); await page.waitForTimeout(80); assert.equal(await page.locator('#composer').isDisabled(),true);
    await page.getByTitle('Schließen').click(); await page.waitForTimeout(80); assert.equal(await page.locator('#chatView').isVisible(),false);
    await noRuntimeErrors(ctx);
  } finally { await browser.close(); await new Promise(r=>mock.server.close(r)); }
});

test('real browser: settings test/save and demo-HOT', async () => {
  const mock=await startMock(); const ctx=await launchPage(mock.base,{width:1440,height:900}); const {page,browser}=ctx;
  try {
    await page.getByTitle('Einstellungen').first().click(); await page.getByRole('button',{name:'Verbindung testen'}).click(); await page.waitForTimeout(60); assert.match(await page.locator('#testResult').textContent(),/Verbindung funktioniert/);
    await page.locator('#sDisclosure').click(); await page.getByRole('button',{name:'Speichern'}).click(); await page.waitForTimeout(60); assert.equal(await page.locator('#settingsModal').isVisible(),false);
    await page.getByTitle('Einstellungen').first().click(); await page.getByRole('button',{name:/Demo-HOT-Lead/}).click(); await page.waitForTimeout(80); assert.equal(await page.locator('#fHot').evaluate(e=>e.classList.contains('active')),true); assert.ok(await page.locator('.chatRow').count()>=2);
    await noRuntimeErrors(ctx);
  } finally { await browser.close(); await new Promise(r=>mock.server.close(r)); }
});

test('real browser mobile: bottom nav, chat open and back', async () => {
  const mock=await startMock(); const ctx=await launchPage(mock.base,{width:390,height:844}); const {page,browser}=ctx;
  try {
    const nav=page.locator('.mobileNav'); await expectVisible(page,'.mobileNav');
    await nav.getByText('HOT',{exact:false}).click(); assert.equal(await page.locator('#fHot').evaluate(e=>e.classList.contains('active')),true);
    await nav.getByText('Chats',{exact:false}).click(); await page.getByText('Anna Hot',{exact:true}).click(); assert.equal(await page.locator('#chatPane').evaluate(e=>e.classList.contains('mobileOpen')),true);
    await page.locator('.backBtn').click(); assert.equal(await page.locator('#chatPane').evaluate(e=>e.classList.contains('mobileOpen')),false);
    await nav.getByText('Profile',{exact:false}).click(); await expectVisible(page,'#profilesModal'); await page.locator('#profilesModal .modalHead button').click();
    await nav.getByText('Setup',{exact:false}).click(); await expectVisible(page,'#settingsModal');
    await noRuntimeErrors(ctx);
  } finally { await browser.close(); await new Promise(r=>mock.server.close(r)); }
});
