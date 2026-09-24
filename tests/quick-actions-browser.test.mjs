import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { chromium } from 'playwright-core';

const html = readFileSync('public/index.html', 'utf8');
const now = new Date().toISOString();

function json(res, status, value) {
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(JSON.stringify(value));
}

async function startMock() {
  const profile = {
    id: 'p1', name: 'Panda', phone_label: 'Panda', location: 'Köln', desired_location: 'Köln', price_text: '80 €', hours_text: '10–22',
    status: 'online', connection: { status: 'online' }, bot_enabled: true, system_prompt: '', qualification_prompt: '', hot_threshold: .8,
    response_style: 'kurz', max_ai_turns: 8, handoff_behavior: 'stop', voice_mode: 'off', llm_model_override: null, temperature: .35,
    voice_name: 'alloy', media: ['https://example.com/test.jpg'], quick_replies: ['Hallo {{name}}'],
    share_location: { label: 'Köln', address: 'Köln', latitude: 50.9375, longitude: 6.9603 }, entry_photos: {}
  };
  const conversation = {
    id: 'c1', profile_id: 'p1', wa_jid: '49111@s.whatsapp.net', contact_name: 'Test Lead', state: 'HUMAN_ACTIVE', hot_score: .9,
    hot_reason: 'Test', ai_turns: 1, unread_count: 0, last_message_preview: 'Hi', last_message_at: now
  };
  const settings = { app_name: 'wA-bot', llm_base_url: 'https://example.com', llm_model: 'test', has_llm_key: true, voice_enabled: true, voice_provider: 'same-api', voice_model: 'tts', ai_disclosure_enabled: true };
  const server = createServer((req, res) => {
    const url = new URL(req.url, 'http://127.0.0.1');
    if (url.pathname === '/' && req.method === 'GET') { res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }); return res.end(html); }
    if (url.pathname === '/api/bootstrap') return json(res, 200, { profiles: [profile], conversations: [conversation], settings });
    if (url.pathname === '/api/conversations/c1/messages') return json(res, 200, { data: [] });
    if (url.pathname === '/favicon.ico' || url.pathname === '/.well-known/appspecific/com.chrome.devtools.json') { res.writeHead(204); return res.end(); }
    return json(res, 200, { ok: true });
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  return { server, base: `http://127.0.0.1:${server.address().port}` };
}

async function openPage(base, width, height) {
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || (process.platform === 'darwin' ? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' : '/usr/bin/chromium-browser'), headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage'] });
  const page = await browser.newPage({ viewport: { width, height } });
  await page.goto(base + '/', { waitUntil: 'networkidle' });
  return { browser, page };
}

test('desktop 1920 renders the quick-action toolbox as a permanent right column', async () => {
  const mock = await startMock();
  const { browser, page } = await openPage(mock.base, 1920, 1080);
  try {
    const toolbox = page.locator('#quickToolbox');
    assert.equal(await toolbox.isVisible(), true, 'quick toolbox must be visible on wide desktop');
    const box = await toolbox.boundingBox();
    assert.ok(box, 'quick toolbox has no layout box');
    assert.ok(box.width >= 340 && box.width <= 380, `unexpected toolbox width ${box.width}`);
    assert.ok(box.x + box.width >= 1919, `toolbox does not occupy the right edge: x=${box.x}, width=${box.width}`);
    for (const label of ['Antworten', 'Fotos', 'GPS', 'Sprache']) {
      assert.equal(await page.locator('[data-tool-tab]').filter({ hasText: label }).isVisible(), true, `${label} tab missing`);
    }
    assert.equal(await page.locator('.toolboxToggle').isVisible(), false, 'drawer toggle must be hidden on wide desktop');
  } finally {
    await browser.close();
    await new Promise(resolve => mock.server.close(resolve));
  }
});

test('narrow desktop exposes the toolbox as an operator drawer', async () => {
  const mock = await startMock();
  const { browser, page } = await openPage(mock.base, 1280, 800);
  try {
    await page.getByText('Test Lead', { exact: true }).click();
    const toggle = page.locator('.toolboxToggle');
    assert.equal(await toggle.isVisible(), true, 'toolbox drawer toggle missing');
    await toggle.click();
    await page.waitForTimeout(220);
    const toolbox = page.locator('#quickToolbox');
    const box = await toolbox.boundingBox();
    assert.ok(box, 'opened toolbox drawer has no box');
    assert.ok(box.x < 1280 && box.x + box.width >= 1279, `drawer is not visible at right edge: x=${box.x}, width=${box.width}`);
    assert.equal(await page.locator('#toolBackdrop').isVisible(), true, 'drawer backdrop missing');
  } finally {
    await browser.close();
    await new Promise(resolve => mock.server.close(resolve));
  }
});
