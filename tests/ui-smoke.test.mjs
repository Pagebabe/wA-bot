import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const html = readFileSync('public/index.html', 'utf8');
const server = readFileSync('src/server.ts', 'utf8');
const scriptMatch = html.match(/<script>([\s\S]*?)<\/script>/);
assert.ok(scriptMatch, 'inline application script must exist');
const script = scriptMatch[1];

function allMatches(re, text) {
  return [...text.matchAll(re)].map((m) => m[1]);
}

test('UI script parses', () => {
  assert.doesNotThrow(() => new vm.Script(script));
});

test('every static button is wired or explicitly disabled', () => {
  const buttons = [...html.matchAll(/<button\b([^>]*)>/gi)].map((m) => m[1]);
  const dead = buttons.filter((attrs) => !/\bonclick\s*=/.test(attrs) && !/\bdisabled\b/.test(attrs));
  assert.deepEqual(dead, [], `dead buttons: ${dead.join(' | ')}`);
});

test('all inline click handlers point to defined functions', () => {
  const handlers = [...html.matchAll(/onclick="([^"]+)"/g)].map((m) => m[1]);
  const calls = new Set();
  for (const handler of handlers) {
    for (const m of handler.matchAll(/\b([A-Za-z_$][\w$]*)\s*\(/g)) {
      if (!['confirm'].includes(m[1])) calls.add(m[1]);
    }
  }
  const defs = new Set([
    ...allMatches(/function\s+([A-Za-z_$][\w$]*)\s*\(/g, script),
    ...allMatches(/async\s+function\s+([A-Za-z_$][\w$]*)\s*\(/g, script),
  ]);
  const missing = [...calls].filter((name) => !defs.has(name));
  assert.deepEqual(missing, [], `handlers without function: ${missing.join(', ')}`);
});

test('all direct DOM id references exist exactly once', () => {
  const ids = [...html.matchAll(/\bid="([^"]+)"/g)].map((m) => m[1]);
  const duplicates = ids.filter((id, i) => ids.indexOf(id) !== i);
  assert.deepEqual(duplicates, [], `duplicate ids: ${duplicates.join(', ')}`);
  const idSet = new Set(ids);
  const refs = new Set(allMatches(/\$\('([^']+)'\)/g, script));
  const missing = [...refs].filter((id) => !idSet.has(id));
  assert.deepEqual(missing, [], `script references missing ids: ${missing.join(', ')}`);
});

test('core interaction functions exist', () => {
  const required = [
    'load','render','renderChatList','openChat','loadMessages','takeover','returnAi','closeConversation','sendMessage',
    'setFilter','mobileFilter','mobileBack','openProfiles','newProfile','editProfile','saveProfile','cloneProfile','deleteProfile',
    'connectProfile','pollQr','unlinkProfile','openSettings','saveSettings','testLlm','seedHot','alarm',
  ];
  for (const name of required) assert.match(script, new RegExp(`(?:async\\s+)?function\\s+${name}\\s*\\(`), `${name} missing`);
});

test('profile configuration exposes the shipped backend options', () => {
  for (const id of ['pName','pLocation','pPrice','pHours','pBot','pSystem','pQualify','pThreshold','pTurns','pStyle','pHandoff','pVoice','pModel','pTemp','pVoiceName','pMedia']) {
    assert.match(html, new RegExp(`id="${id}"`), `${id} missing`);
  }
  assert.match(html, /id="pModel" readonly/);
  assert.match(html, /id="pTemp"[\s\S]{0,100}readonly/);
  assert.doesNotMatch(script, /llm_model_override:/);
  assert.doesNotMatch(script, /temperature:/);
  assert.match(html, /id="pVoiceName" readonly/);
  assert.doesNotMatch(script, /voice_name:/);
  assert.match(script, /media:/);
});

test('composer is ownership-gated in UI and API', () => {
  assert.match(html, /id="composer"[^>]*disabled/);
  assert.match(script, /state\.currentChat\.state !== "HUMAN_ACTIVE"/);
  assert.match(script, /const canWrite = c\.state === "HUMAN_ACTIVE"/);
  assert.match(server, /c\.state !== 'HUMAN_ACTIVE'/);
});

test('profile mutation is validated instead of accepting arbitrary DB fields', () => {
  assert.match(server, /Unbekannte Profilfelder/);
  assert.match(server, /hot_threshold: GLOBAL_HOT_THRESHOLD/);
  assert.match(server, /max_ai_turns: GLOBAL_MAX_AI_TURNS/);
  assert.doesNotMatch(server, /'bot_enabled', 'hot_threshold'/);
});

test('LLM secret can come from deployment environment without exposing it to bootstrap', () => {
  assert.match(server, /process\.env\.LLM_API_KEY/);
  assert.match(server, /process\.env\.LLM_BASE_URL/);
  assert.match(server, /process\.env\.LLM_MODEL/);
  assert.match(server, /has_llm_key: Boolean\(raw\?\.llm_api_key_encrypted\)/);
  assert.doesNotMatch(server, /safeSettings[\s\S]{0,800}llm_api_key_encrypted\s*:/);
});

test('all UI API calls have corresponding server routes', () => {
  const expectedRouteFragments = [
    "'/api/bootstrap'",
    "'/api/settings'",
    "'/api/settings/test'",
    "'/api/profiles'",
    "'/api/profiles/:id'",
    "'/api/profiles/:id/clone'",
    "'/api/profiles/:id/connect'",
    "'/api/profiles/:id/connection'",
    "'/api/profiles/:id/unlink'",
    "'/api/conversations/:id/messages'",
    "'/api/conversations/:id/takeover'",
    "'/api/conversations/:id/return-ai'",
    "'/api/conversations/:id/close'",
    "'/api/conversations/:id/send'",
    "'/api/demo/hot'",
  ];
  for (const route of expectedRouteFragments) assert.ok(server.includes(route), `server route missing ${route}`);
});

test('QR polling can be cancelled when modal closes', () => {
  assert.match(script, /qrPollToken/);
  assert.match(script, /if \(id === "qrModal"\) state\.qrPollToken\+\+/);
  assert.match(script, /token !== state\.qrPollToken/);
});

test('mobile navigation and desktop navigation are both present', () => {
  assert.match(html, /class="rail"/);
  assert.match(html, /class="mobileNav"/);
  assert.match(html, /mobileFilter\('all'/);
  assert.match(html, /mobileFilter\('hot'/);
  assert.match(html, /openProfiles\(\)/);
  assert.match(html, /openSettings\(\)/);
});
