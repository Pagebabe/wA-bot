import test from 'node:test';
import assert from 'node:assert/strict';
import { qualifyLead } from '../dist/ai.js';

const profile = {
  id: 'p1',
  name: 'Test',
  status: 'online',
  bot_enabled: true,
  system_prompt: 'central-policy',
  qualification_prompt: 'central-policy',
  hot_threshold: 0.8,
  response_style: 'zentral',
  max_ai_turns: 8,
  handoff_behavior: 'stop',
  voice_mode: 'off',
  price_text: 'ab 80 € / 60 Min.',
  hours_text: '10-22 Uhr',
};

const conversation = {
  id: 'c1',
  profile_id: 'p1',
  wa_jid: 'test@simulation.invalid',
  state: 'AI_ACTIVE',
  ai_turns: 0,
  unread_count: 0,
};

function m(id, text) {
  return {
    id,
    conversation_id: 'c1',
    direction: 'in',
    sender: 'lead',
    kind: 'text',
    text,
    created_at: new Date().toISOString(),
  };
}

test('time plus duration becomes HOT without an LLM call', async () => {
  const result = await qualifyLead({}, profile, conversation, [m('1', 'Heute 19:30'), m('2', '30 Minuten')]);
  assert.equal(result.hot, true);
  assert.equal(result.reply, '');
});

test('time without duration asks only for duration without an LLM call', async () => {
  const result = await qualifyLead({}, profile, conversation, [m('1', 'Heute 19:30')]);
  assert.equal(result.hot, false);
  assert.match(result.reply, /lange/i);
});

test('duration without time asks only for time without an LLM call', async () => {
  const result = await qualifyLead({}, profile, conversation, [m('1', '30 Minuten')]);
  assert.equal(result.hot, false);
  assert.match(result.reply, /wann/i);
});

test('arrival immediately becomes HOT', async () => {
  const result = await qualifyLead({}, profile, conversation, [m('1', 'Ich bin da.')]);
  assert.equal(result.hot, true);
});
