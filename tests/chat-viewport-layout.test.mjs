import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { chromium } from 'playwright-core';

const html = readFileSync('public/index.html', 'utf8');
const now = () => new Date().toISOString();

function json(res, status, value) {
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(JSON.stringify(value));
}

async function bodyJson(req) {
  return new Promise((resolve) => {
    let data = '';
    req.on('data', (chunk) => { data += chunk; });
    req.on('end', () => {
      try { resolve(data ? JSON.parse(data) : {}); } catch { resolve({}); }
    });
  });
}

async function startMock() {
  const profile = {
    id: 'p1', name: 'Testprofil 1 Köln', phone_label: 'Köln 1', location: 'Köln', desired_location: 'Köln', price_text: '80 €', hours_text: '10–22',
    status: 'online', connection: { status: 'online' }, bot_enabled: true, system_prompt: '', qualification_prompt: '', hot_threshold: .8,
    response_style: 'kurz', max_ai_turns: 8, handoff_behavior: 'stop', voice_mode: 'off', llm_model_override: null, temperature: .35,
    voice_name: 'alloy', media: [], quick_replies: ['Hallo {{name}}'], share_location: null, entry_photos: {},
  };
  const conversations = [
    { id: 'c-panda', profile_id: 'p1', wa_jid: '49111@s.whatsapp.net', contact_name: 'Panda', state: 'HUMAN_ACTIVE', hot_score: null, hot_reason: null, ai_turns: 1, unread_count: 0, last_message_preview: 'Viele Nachrichten', last_message_at: now() },
    { id: 'c-second', profile_id: 'p1', wa_jid: '49222@s.whatsapp.net', contact_name: 'Zweiter Testchat', state: 'HUMAN_ACTIVE', hot_score: null, hot_reason: null, ai_turns: 1, unread_count: 0, last_message_preview: 'Zweiter Chat', last_message_at: new Date(Date.now() - 60_000).toISOString() },
  ];
  const messages = {
    'c-panda': Array.from({ length: 140 }, (_, index) => ({ id: `m-${index}`, conversation_id: 'c-panda', direction: index % 2 ? 'out' : 'in', sender: index % 2 ? 'human' : 'lead', kind: 'text', text: `Nachricht ${index + 1}: Layout darf durch lange Verläufe nicht wachsen.`, created_at: now() })),
    'c-second': Array.from({ length: 12 }, (_, index) => ({ id: `s-${index}`, conversation_id: 'c-second', direction: 'in', sender: 'lead', kind: 'text', text: `Zweiter Verlauf ${index + 1}`, created_at: now() })),
  };
  const settings = { app_name: 'wA-bot', llm_base_url: 'https://example.com', llm_model: 'test', has_llm_key: true, voice_enabled: false, voice_provider: 'same-api', voice_model: 'tts', ai_disclosure_enabled: true };

  const server = createServer(async (req, res) => {
    const url = new URL(req.url, 'http://127.0.0.1');
    if (url.pathname === '/' && req.method === 'GET') {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      return res.end(html);
    }
    if (url.pathname === '/api/bootstrap' && req.method === 'GET') return json(res, 200, { profiles: [profile], conversations, settings, savedReplies: profile.quick_replies });
    const messageMatch = url.pathname.match(/^\/api\/conversations\/([^/]+)\/messages$/);
    if (messageMatch && req.method === 'GET') return json(res, 200, { data: messages[messageMatch[1]] || [] });
    const sendMatch = url.pathname.match(/^\/api\/conversations\/([^/]+)\/send$/);
    if (sendMatch && req.method === 'POST') {
      const body = await bodyJson(req);
      const list = messages[sendMatch[1]] ??= [];
      list.push({ id: `sent-${list.length}`, conversation_id: sendMatch[1], direction: 'out', sender: 'human', kind: 'text', text: String(body.text || ''), created_at: now() });
      return json(res, 200, { ok: true });
    }
    if (url.pathname === '/favicon.ico' || url.pathname === '/.well-known/appspecific/com.chrome.devtools.json') {
      res.writeHead(204);
      return res.end();
    }
    return json(res, 200, { ok: true });
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  return { server, base: `http://127.0.0.1:${server.address().port}` };
}

async function assertViewportLayout(page, label) {
  const metrics = await page.evaluate(() => {
    const box = (selector) => {
      const rect = document.querySelector(selector)?.getBoundingClientRect();
      return rect ? { top: rect.top, right: rect.right, bottom: rect.bottom, left: rect.left, width: rect.width, height: rect.height } : null;
    };
    const style = (selector) => {
      const element = document.querySelector(selector);
      if (!element) return null;
      const computed = getComputedStyle(element);
      return { minHeight: computed.minHeight, overflowX: computed.overflowX, overflowY: computed.overflowY };
    };
    return {
      innerWidth: window.innerWidth,
      innerHeight: window.innerHeight,
      bodyScrollHeight: document.body.scrollHeight,
      bodyScrollWidth: document.body.scrollWidth,
      rootScrollHeight: document.documentElement.scrollHeight,
      rootScrollWidth: document.documentElement.scrollWidth,
      shell: box('.shell'), chatPane: box('#chatPane'), chatView: box('#chatView'), chatHead: box('.chatHead'), messages: box('#messages'), composer: box('.composer'), listPane: box('.listPane'), chatList: box('#chatList'), toolbox: box('#quickToolbox'), modal: box('.modal.open .modalCard'),
      messagesStyle: style('#messages'), chatViewStyle: style('#chatView'), chatPaneStyle: style('#chatPane'), chatListStyle: style('#chatList'), toolboxStyle: style('#quickToolbox'), toolPanelStyle: style('#quickToolbox .toolPanel.active'), modalBodyStyle: style('.modal.open .modalBody'),
    };
  });
  const epsilon = 1;
  assert.ok(metrics.bodyScrollHeight <= metrics.innerHeight + epsilon, `${label}: body grows to ${metrics.bodyScrollHeight}px for ${metrics.innerHeight}px viewport`);
  assert.ok(metrics.rootScrollHeight <= metrics.innerHeight + epsilon, `${label}: root grows to ${metrics.rootScrollHeight}px`);
  assert.ok(metrics.bodyScrollWidth <= metrics.innerWidth + epsilon, `${label}: horizontal body overflow`);
  assert.ok(metrics.rootScrollWidth <= metrics.innerWidth + epsilon, `${label}: horizontal root overflow`);
  for (const [name, rect] of [['shell', metrics.shell], ['chat pane', metrics.chatPane], ['chat view', metrics.chatView], ['chat head', metrics.chatHead], ['composer', metrics.composer], ['list pane', metrics.listPane], ['chat list', metrics.chatList]]) {
    assert.ok(rect, `${label}: ${name} has no box`);
    assert.ok(rect.top >= -epsilon && rect.bottom <= metrics.innerHeight + epsilon, `${label}: ${name} leaves viewport (${rect.top}..${rect.bottom})`);
  }
  assert.ok(metrics.composer.height > 0, `${label}: composer collapsed`);
  assert.equal(metrics.messagesStyle?.overflowY, 'auto', `${label}: messages must scroll vertically`);
  assert.equal(metrics.messagesStyle?.minHeight, '0px', `${label}: messages need min-height: 0`);
  assert.equal(metrics.chatViewStyle?.minHeight, '0px', `${label}: chatView needs min-height: 0`);
  assert.equal(metrics.chatPaneStyle?.minHeight, '0px', `${label}: chat pane needs min-height: 0`);
  assert.equal(metrics.chatListStyle?.overflowY, 'auto', `${label}: chat list must scroll internally`);
  if (metrics.toolbox && metrics.toolbox.width > 0) {
    assert.ok(metrics.toolbox.bottom <= metrics.innerHeight + epsilon, `${label}: toolbox leaves viewport`);
    assert.equal(metrics.toolPanelStyle?.overflowY, 'auto', `${label}: quick actions must scroll internally`);
  }
  if (metrics.modal) {
    assert.ok(metrics.modal.top >= -epsilon && metrics.modal.bottom <= metrics.innerHeight + epsilon, `${label}: modal leaves viewport`);
    assert.equal(metrics.modalBodyStyle?.overflowY, 'auto', `${label}: modal body must scroll internally`);
  }
}

for (const [width, height] of [[1728, 928], [1440, 800], [1280, 700], [1024, 700]]) {
  test(`chat stays inside viewport at ${width}x${height}`, async () => {
    const mock = await startMock();
    const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium-browser', headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage'] });
    const page = await browser.newPage({ viewport: { width, height } });
    try {
      await page.goto(mock.base + '/', { waitUntil: 'networkidle' });
      await page.getByText('Panda', { exact: true }).click();
      await assertViewportLayout(page, `${width}x${height} initial`);
      await page.locator('#messages').evaluate((element) => { element.scrollTop = element.scrollHeight; });
      const sent = `Viewport-Test ${width}x${height}`;
      await page.locator('#composer').fill(sent);
      await page.locator('.sendBtn').click();
      await page.waitForFunction((text) => document.querySelector('#messages')?.textContent?.includes(text), sent);
      assert.equal(await page.getByText(sent, { exact: true }).isVisible(), true, `${width}x${height}: sent message not visible`);
      await assertViewportLayout(page, `${width}x${height} after send`);

      await page.getByText('Zweiter Testchat', { exact: true }).click();
      await page.getByText('Panda', { exact: true }).click();
      await assertViewportLayout(page, `${width}x${height} after chat switch`);

      if (width <= 1350) {
        await page.locator('.toolboxToggle').click();
        await page.waitForTimeout(220);
      }
      await assertViewportLayout(page, `${width}x${height} quick actions`);
      if (width <= 1350) await page.locator('#toolBackdrop').click();

      await page.locator('.rail button[title="Profile"]').click();
      await assertViewportLayout(page, `${width}x${height} profile dialog`);
      await page.locator('#profilesModal .modalHead button').click();
      await page.locator('.rail button[title="Einstellungen"]').click();
      await assertViewportLayout(page, `${width}x${height} settings dialog`);
      await page.locator('#settingsModal .modalHead button').click();
      await assertViewportLayout(page, `${width}x${height} final`);
    } finally {
      await browser.close();
      await new Promise((resolve) => mock.server.close(resolve));
    }
  });
}
