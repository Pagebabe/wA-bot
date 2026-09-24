import test from 'node:test';
import assert from 'node:assert/strict';
import { qualifyLead } from '../dist/ai.js';

const profile = {
  id: 'prod-smoke-profile',
  name: 'Production Smoke',
  price_text: '30 Min 80 € · 60 Min 140 €',
};

const conversation = {
  id: 'prod-smoke-conversation',
  profile_id: profile.id,
  wa_jid: 'smoke@simulation.invalid',
  contact_name: 'Smoke Lead',
  state: 'AI_ACTIVE',
  hot_score: null,
  hot_reason: null,
  ai_turns: 0,
  unread_count: 0,
};

function msg(sender, text, i) {
  return {
    id: 'm' + i,
    conversation_id: conversation.id,
    direction: sender === 'lead' ? 'in' : 'out',
    sender,
    kind: 'text',
    text,
    created_at: new Date(1790295000000 + i * 1000).toISOString(),
  };
}

async function runConversation(leadTurns) {
  const history = [];
  const results = [];
  let i = 0;
  for (const leadText of leadTurns) {
    history.push(msg('lead', leadText, ++i));
    const result = await qualifyLead({}, profile, conversation, history);
    results.push(result);
    if (result.reply) history.push(msg('ai', result.reply, ++i));
    if (result.hot) break;
  }
  return { history, results };
}

test('realistic booking flow reaches HOT only after explicit confirmation', async () => {
  const { results } = await runConversation([
    'Hi, was kostet 30 Minuten?',
    'Heute 20:00',
    '30 Minuten',
    'Ja',
  ]);
  assert.equal(results[0].hot, false);
  assert.match(results[0].reply, /80/);
  assert.match(results[0].reply, /wann/i);
  assert.equal(results[1].hot, false);
  assert.equal(results[2].hot, false);
  assert.match(results[2].reply, /Bestätigung/i);
  assert.equal(results[3].hot, true);
  assert.equal(results[3].reply, '');
});

test('realistic cancellation never becomes HOT', async () => {
  const { results } = await runConversation([
    'Was kostet eine Stunde?',
    'Heute 21 Uhr',
    '60 Minuten',
    'Doch nicht, sorry.',
  ]);
  const last = results.at(-1);
  assert.equal(last.hot, false);
  assert.ok(last.score < 0.2);
  assert.match(last.reason, /Absage|Abbruch/);
});

test('hesitation stays non-HOT and removes confirmation pressure', async () => {
  const { results } = await runConversation([
    'Morgen 18:30',
    '30 Minuten',
    'Ich überlege noch.',
  ]);
  const last = results.at(-1);
  assert.equal(last.hot, false);
  assert.ok(last.score < 0.3);
  assert.doesNotMatch(last.reply, /Bestätigung/i);
});

test('ETA is not misread as requested duration', async () => {
  const { results } = await runConversation([
    'Kann ich in 20 Minuten kommen?',
  ]);
  const last = results.at(-1);
  assert.equal(last.hot, false);
  assert.match(last.reply, /wie lange/i);
});

test('arrival escalates immediately to HOT', async () => {
  const { results } = await runConversation([
    'Bin da.',
  ]);
  const last = results.at(-1);
  assert.equal(last.hot, true);
  assert.equal(last.reply, '');
  assert.ok(last.score >= 0.98);
});

test('clear commitment with missing slots stays WARM, not HOT', async () => {
  const { results } = await runConversation([
    'Ja ich komme.',
  ]);
  const last = results.at(-1);
  assert.equal(last.hot, false);
  assert.ok(last.score >= 0.7 && last.score < 0.8);
  assert.match(last.reason, /WARM/);
});
