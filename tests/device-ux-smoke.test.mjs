import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { chromium } from 'playwright-core';

const html = readFileSync('public/index.html', 'utf8');
const now = () => new Date().toISOString();

function json(res, status, value) {
  res.writeHead(status, { 'content-type':'application/json' });
  res.end(JSON.stringify(value));
}

async function startMock() {
  const profiles = [{
    id: 'p1', name: 'Köln Profil', phone_label: 'Köln 1', location: 'Köln', price_text: 'ab 80 €', hours_text: '10–22',
    status: 'offline', connection: { status: 'offline', qr: null }, bot_enabled: true,
    system_prompt: 'Qualifiziere kurz.', qualification_prompt: 'Terminbereit ist HOT.', hot_threshold: .8,
    response_style: 'kurz', max_ai_turns: 8, handoff_behavior: 'stop', voice_mode: 'off', llm_model_override: null,
    temperature: .35, voice_name: 'alloy', media: [],
  }];
  const conversations = [
    { id: 'c-hot', profile_id: 'p1', wa_jid: '49111@s.whatsapp.net', contact_name: 'Anna Hot', state: 'HOT', hot_score: .94, hot_reason: 'Terminbereit', ai_turns: 2, unread_count: 2, last_message_preview: 'Heute passt.', last_message_at: now() },
    { id: 'c-ai', profile_id: 'p1', wa_jid: '49222@s.whatsapp.net', contact_name: 'Ben KI', state: 'AI_ACTIVE', hot_score: null, hot_reason: null, ai_turns: 1, unread_count: 0, last_message_preview: 'Was kostet es?', last_message_at: now() },
  ];
  const messages = {
    'c-hot': [{ id:'m1', conversation_id:'c-hot', direction:'in', sender:'lead', kind:'text', text:'Heute passt.', created_at:now() }],
    'c-ai': [{ id:'m2', conversation_id:'c-ai', direction:'in', sender:'lead', kind:'text', text:'Was kostet es?', created_at:now() }],
  };
  const settings = { app_name:'wA-bot', llm_base_url:'https://integrate.api.nvidia.com', llm_model:'test-model', has_llm_key:true, voice_enabled:false, voice_provider:'same-api', voice_model:'tts', ai_disclosure_enabled:true };
  const server = createServer((req, res) => {
    const path = new URL(req.url, 'http://127.0.0.1').pathname;
    if (path === '/' && req.method === 'GET') { res.writeHead(200, {'content-type':'text/html; charset=utf-8'}); return res.end(html); }
    if (path === '/api/bootstrap' && req.method === 'GET') return json(res,200,{profiles,conversations,settings});
    const msg = path.match(/^\/api\/conversations\/([^/]+)\/messages$/);
    if (msg && req.method === 'GET') return json(res,200,{data:messages[msg[1]] || []});
    if (path === '/favicon.ico' || path === '/.well-known/appspecific/com.chrome.devtools.json') { res.writeHead(204); return res.end(); }
    return json(res,200,{ok:true,status:200,text:'OK'});
  });
  await new Promise(resolve => server.listen(0,'127.0.0.1',resolve));
  const { port } = server.address();
  return { server, base:`http://127.0.0.1:${port}` };
}

async function launch(base, viewport) {
  const browser = await chromium.launch({
    executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium-browser',
    headless: true,
    args: ['--no-sandbox','--disable-dev-shm-usage'],
  });
  const page = await browser.newPage({ viewport, hasTouch: viewport.width <= 900, isMobile: viewport.width <= 500 });
  const pageErrors=[]; const consoleErrors=[]; const failed=[];
  page.on('pageerror', e => pageErrors.push(e.message));
  page.on('console', m => { if (m.type()==='error') consoleErrors.push(m.text()); });
  page.on('requestfailed', r => failed.push(`${r.method()} ${r.url()} ${r.failure()?.errorText || ''}`));
  page.on('dialog', d => d.accept());
  await page.goto(base+'/', { waitUntil:'networkidle' });
  return { browser, page, pageErrors, consoleErrors, failed };
}

async function assertHitTarget(locator, label) {
  assert.equal(await locator.isVisible(), true, `${label}: not visible`);
  const result = await locator.evaluate(el => {
    const r = el.getBoundingClientRect();
    const x = Math.max(0, Math.min(innerWidth - 1, r.left + r.width / 2));
    const y = Math.max(0, Math.min(innerHeight - 1, r.top + r.height / 2));
    const hit = document.elementFromPoint(x, y);
    return {
      ok: hit === el || el.contains(hit),
      hit: hit ? `${hit.tagName.toLowerCase()}#${hit.id}.${String(hit.className || '').replace(/\s+/g,'.')}` : 'none',
      rect: { left:r.left, top:r.top, width:r.width, height:r.height },
      point: { x, y },
    };
  });
  assert.equal(result.ok, true, `${label}: center blocked by ${result.hit} at ${JSON.stringify(result.point)} rect=${JSON.stringify(result.rect)}`);
}

async function assertNoViewportOverflow(page, label) {
  const size = await page.evaluate(() => ({
    docW: document.documentElement.scrollWidth,
    winW: innerWidth,
    docH: document.documentElement.scrollHeight,
    winH: innerHeight,
  }));
  assert.ok(size.docW <= size.winW + 1, `${label}: horizontal overflow ${size.docW-size.winW}px`);
}

const devices = [
  ['phone-320x568', 320, 568],
  ['phone-360x800', 360, 800],
  ['phone-390x844', 390, 844],
  ['phone-412x915', 412, 915],
  ['tablet-768x1024', 768, 1024],
  ['tablet-landscape-1024x768', 1024, 768],
  ['laptop-1366x768', 1366, 768],
  ['desktop-1440x900', 1440, 900],
  ['desktop-1920x1080', 1920, 1080],
];

for (const [name,width,height] of devices) {
  test(`device UX ${name}: top controls, click targets and fit`, async () => {
    const mock = await startMock();
    const ctx = await launch(mock.base,{width,height});
    const { page, browser } = ctx;
    try {
      await page.waitForTimeout(120);
      await assertNoViewportOverflow(page,name);

      const topAdd = page.locator('.listTop .topActions button[title="Profil hinzufügen"]');
      const topSettings = page.locator('.listTop .topActions button[title="Einstellungen"]');
      const profileSelect = page.locator('#profileSelect');
      const profileManage = page.locator('.profileChooser button[title="Profile verwalten"]');
      await assertHitTarget(topAdd,`${name} add-profile`);
      await assertHitTarget(topSettings,`${name} top-settings`);
      await assertHitTarget(profileSelect,`${name} profile-select`);
      await assertHitTarget(profileManage,`${name} profile-manage`);

      for (const id of ['#fAll','#fUnread','#fHot','#fMine','#fAi']) {
        await assertHitTarget(page.locator(id),`${name} ${id}`);
      }

      if (width <= 900) {
        assert.equal(await page.locator('.mobileNav').isVisible(),true,`${name}: mobile nav missing`);
        for (const text of ['Chats','HOT','Profile','Setup']) {
          await assertHitTarget(page.locator('.mobileNav button').filter({hasText:text}).first(),`${name} mobile ${text}`);
        }
      } else {
        assert.equal(await page.locator('.rail').isVisible(),true,`${name}: desktop rail missing`);
        for (const title of ['Chats','HOT','Profile','Einstellungen']) {
          await assertHitTarget(page.locator(`.rail button[title="${title}"]`),`${name} rail ${title}`);
        }
      }

      await topAdd.click();
      assert.equal(await page.locator('#profileModal').isVisible(),true,`${name}: add-profile modal did not open`);
      await assertHitTarget(page.locator('#profileModal .modalHead button'),`${name} profile-modal close`);
      await page.locator('#profileModal .modalHead button').click();

      await topSettings.click();
      assert.equal(await page.locator('#settingsModal').isVisible(),true,`${name}: settings modal did not open`);
      await assertHitTarget(page.locator('#settingsModal .modalHead button'),`${name} settings-modal close`);
      await page.locator('#settingsModal .modalHead button').click();

      await page.getByText('Anna Hot',{exact:true}).click();
      assert.equal(await page.locator('#chatView').isVisible(),true,`${name}: chat view did not open`);
      if (width <= 900) {
        assert.equal(await page.locator('#chatPane').evaluate(e=>e.classList.contains('mobileOpen')),true,`${name}: mobile chat pane did not open`);
        await page.waitForTimeout(240);
      }
      await assertHitTarget(page.locator('#takeBtn'),`${name} takeover`);
      await assertHitTarget(page.locator('.chatActions button[title="Schließen"]'),`${name} close-chat`);
      if (width <= 900) await assertHitTarget(page.locator('.backBtn'),`${name} mobile-back`);

      assert.deepEqual(ctx.pageErrors,[],`${name}: page errors ${ctx.pageErrors.join(' | ')}`);
      assert.deepEqual(ctx.consoleErrors,[],`${name}: console errors ${ctx.consoleErrors.join(' | ')}`);
      assert.deepEqual(ctx.failed,[],`${name}: failed requests ${ctx.failed.join(' | ')}`);
    } finally {
      await browser.close();
      await new Promise(resolve => mock.server.close(resolve));
    }
  });
}
