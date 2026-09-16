import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const server = readFileSync('src/server.ts','utf8');
const html = readFileSync('public/index.html','utf8');

test('global LLM base and model remain UI-editable while deployment key stays authoritative', () => {
  assert.match(server, /llm_base_url: stored\.llm_base_url \|\| process\.env\.LLM_BASE_URL/);
  assert.match(server, /llm_model: stored\.llm_model \|\| process\.env\.LLM_MODEL/);
  assert.match(server, /llm_api_key_encrypted: process\.env\.LLM_API_KEY \|\| stored\.llm_api_key_encrypted/);
  assert.match(server, /llm_key_source: process\.env\.LLM_API_KEY \? 'environment' : 'database'/);
  assert.match(html, /s\.llm_key_source === "environment"/);
  assert.match(html, /Railway-Secret aktiv/);
});

test('beta UI does not advertise handoff or voice-provider modes that runtime does not implement', () => {
  assert.match(html, /<select id="pHandoff" disabled>[\s\S]*?<option value="stop">KI stoppt \(Beta\)<\/option>[\s\S]*?<\/select>/);
  assert.doesNotMatch(html, /value="assist">KI assistiert/);
  assert.doesNotMatch(html, /value="continue">KI darf weiter/);
  assert.match(html, /<input[\s\S]{0,160}id="sVoiceProvider"[\s\S]{0,160}disabled/);
});
