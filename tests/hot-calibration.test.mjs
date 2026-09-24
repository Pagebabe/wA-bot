import test from 'node:test';
import assert from 'node:assert/strict';
import { qualifyLead } from '../dist/ai.js';

const profile = { id: 'p1', name: 'Test' };
const conversation = {
  id: 'c1',
  profile_id: 'p1',
  wa_jid: 'lead@simulation.invalid',
  contact_name: 'Lead',
  state: 'AI_ACTIVE',
  hot_score: null,
  hot_reason: null,
  ai_turns: 0,
  unread_count: 0,
};

function m(sender, text, i) {
  return {
    id: 'm' + i,
    conversation_id: 'c1',
    direction: sender === 'lead' ? 'in' : 'out',
    sender,
    kind: 'text',
    text,
    created_at: new Date(1790280000000 + i * 1000).toISOString(),
  };
}

test('time plus duration alone is not HOT anymore', async () => {
  const result = await qualifyLead({}, profile, conversation, [
    m('lead', 'Heute 20:00', 1),
    m('lead', '30 Minuten', 2),
  ]);
  assert.equal(result.hot, false);
  assert.match(result.reply, /Bestätigung/);
  assert.ok(result.score < 0.8);
});

test('explicit confirmation after time and duration becomes HOT', async () => {
  const result = await qualifyLead({}, profile, conversation, [
    m('lead', 'Heute 20:00', 1),
    m('lead', '30 Minuten', 2),
    m('ai', 'Soll ich das so zur Bestätigung weitergeben?', 3),
    m('lead', 'Ja', 4),
  ]);
  assert.equal(result.hot, true);
  assert.equal(result.reply, '');
  assert.ok(result.score >= 0.9);
});

test('current cancellation overrides an earlier commitment', async () => {
  const result = await qualifyLead({}, profile, conversation, [
    m('lead', 'Heute 20:00', 1),
    m('lead', '30 Minuten', 2),
    m('lead', 'Ja ich komme', 3),
    m('lead', 'Doch nicht, sorry', 4),
  ]);
  assert.equal(result.hot, false);
  assert.ok(result.score < 0.2);
  assert.match(result.reason, /Absage|Abbruch/);
});


test('day-only availability asks for a clock time before duration', async () => {
  const result = await qualifyLead({}, profile, conversation, [
    m('lead', 'Hast du heute Zeit?', 1),
  ]);
  assert.equal(result.hot, false);
  assert.match(result.reply, /Uhrzeit/i);
  assert.doesNotMatch(result.reply, /wie lange/i);
});

test('ETA in minutes is not mistaken for requested duration', async () => {
  const result = await qualifyLead({}, profile, conversation, [
    m('lead', 'Kann ich in 20 Minuten kommen?', 1),
  ]);
  assert.equal(result.hot, false);
  assert.match(result.reply, /wie lange/i);
});

test('hesitation stops confirmation pressure', async () => {
  const result = await qualifyLead({}, profile, conversation, [
    m('lead', 'Heute 20:00', 1),
    m('lead', '30 Minuten', 2),
    m('ai', 'Soll ich das so zur Bestätigung weitergeben?', 3),
    m('lead', 'Ich überlege noch.', 4),
  ]);
  assert.equal(result.hot, false);
  assert.ok(result.score < 0.3);
  assert.match(result.reply, /kein stress|sicher bist/i);
  assert.doesNotMatch(result.reply, /bestätigung/i);
});


test('price question returns configured price fact before next slot', async () => {
  const pricedProfile = { ...profile, price_text: 'Ab 80 € / 60 Min.' };
  const result = await qualifyLead({}, pricedProfile, conversation, [
    m('lead', 'Was kostet eine Stunde?', 1),
  ]);
  assert.equal(result.hot, false);
  assert.match(result.reply, /80/);
  assert.match(result.reply, /wann/i);
});

test('price question never invents a missing price', async () => {
  const result = await qualifyLead({}, profile, conversation, [
    m('lead', 'Was kostet 30 Minuten?', 1),
  ]);
  assert.equal(result.hot, false);
  assert.match(result.reply, /kein Preis hinterlegt/i);
});

test('vague later intent asks for a concrete clock time first', async () => {
  const result = await qualifyLead({}, profile, conversation, [
    m('lead', 'Ich könnte später', 1),
  ]);
  assert.equal(result.hot, false);
  assert.match(result.reply, /Uhrzeit/i);
  assert.doesNotMatch(result.reply, /wie lange/i);
});
