import test from 'node:test';
import assert from 'node:assert/strict';
import { persistInboundMessage } from '../dist/inbound-message.js';

function harness(existing) {
  const calls = { updates: [], upserts: [], messages: [] };
  return {
    calls,
    deps: {
      async findConversation() { return existing ? { ...existing } : null; },
      async updateConversation(id, patch) {
        calls.updates.push({ id, patch: { ...patch } });
        return { ...existing, id, ...patch };
      },
      async upsertConversation(data) {
        calls.upserts.push({ ...data });
        return { id: 'new-conversation', ...data };
      },
      async addMessage(data) {
        calls.messages.push({ ...data });
        return data;
      },
    },
  };
}

const baseInput = {
  profileId: 'profile-1',
  jid: '491234@s.whatsapp.net',
  name: 'Lead',
  text: 'Hallo',
  waMessageId: 'wa-1',
  raw: { key: 'raw' },
  kind: 'text',
  botEnabled: true,
  now: '2026-09-16T00:00:00.000Z',
};

test('fresh inbound reopens CLOSED to AI_ACTIVE and stores exactly once', async () => {
  const { deps, calls } = harness({
    id: 'conversation-1', profile_id: 'profile-1', wa_jid: baseInput.jid,
    contact_name: 'Alt', state: 'CLOSED', unread_count: 5, ai_turns: 7,
    hot_score: 0.91, hot_reason: 'old hot',
  });
  const result = await persistInboundMessage(deps, baseInput);
  assert.equal(result.state, 'AI_ACTIVE');
  assert.equal(result.unread_count, 6);
  assert.equal(result.ai_turns, 0);
  assert.equal(result.hot_score, 0);
  assert.equal(result.hot_reason, null);
  assert.equal(calls.updates.length, 1);
  assert.equal(calls.upserts.length, 0);
  assert.equal(calls.messages.length, 1);
  assert.equal(calls.messages[0].conversation_id, 'conversation-1');
  assert.equal(calls.messages[0].wa_message_id, 'wa-1');
});

test('fresh inbound reopens CLOSED to HUMAN_ACTIVE when bot is disabled', async () => {
  const { deps, calls } = harness({
    id: 'conversation-2', profile_id: 'profile-1', wa_jid: baseInput.jid,
    contact_name: 'Lead', state: 'CLOSED', unread_count: 0,
  });
  const result = await persistInboundMessage(deps, { ...baseInput, botEnabled: false, waMessageId: 'wa-2' });
  assert.equal(result.state, 'HUMAN_ACTIVE');
  assert.equal(result.unread_count, 1);
  assert.equal(calls.messages.length, 1);
});

test('non-closed conversation state is preserved', async () => {
  for (const state of ['AI_ACTIVE', 'HOT', 'HUMAN_ACTIVE', 'PAUSED']) {
    const { deps, calls } = harness({
      id: `conversation-${state}`, profile_id: 'profile-1', wa_jid: baseInput.jid,
      contact_name: 'Lead', state, unread_count: 2, ai_turns: 4,
      hot_score: 0.8, hot_reason: 'keep',
    });
    const result = await persistInboundMessage(deps, { ...baseInput, waMessageId: `wa-${state}` });
    assert.equal(result.state, state);
    assert.equal(result.unread_count, 3);
    assert.equal(result.ai_turns, 4);
    assert.equal(result.hot_score, 0.8);
    assert.equal(result.hot_reason, 'keep');
    assert.equal(calls.messages.length, 1);
  }
});

test('new conversation is created and inbound message is stored once', async () => {
  const { deps, calls } = harness(null);
  const result = await persistInboundMessage(deps, { ...baseInput, waMessageId: 'wa-new' });
  assert.equal(result.state, 'AI_ACTIVE');
  assert.equal(result.unread_count, 1);
  assert.equal(calls.updates.length, 0);
  assert.equal(calls.upserts.length, 1);
  assert.equal(calls.messages.length, 1);
  assert.equal(calls.messages[0].conversation_id, 'new-conversation');
});
