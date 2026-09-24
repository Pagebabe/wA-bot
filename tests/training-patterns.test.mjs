import test from 'node:test';
import assert from 'node:assert/strict';
import {
  detectLeadIntents,
  analyzeTrainingSignals,
  buildTrainingGuidance,
} from '../dist/training-patterns.js';

test('training router recognizes the dominant historical chat intents', () => {
  assert.deepEqual(detectLeadIntents('Was kostet 30 Minuten heute um 19:30?'), ['price', 'scheduling', 'duration']);
  assert.ok(detectLeadIntents('Wo ist die Adresse und welche Etage?').includes('location'));
  assert.ok(detectLeadIntents('Kannst du ein Foto schicken?').includes('media'));
});

test('time plus duration is ready for human handoff', () => {
  const messages = [
    { sender: 'lead', text: 'Heute um 19:30', kind: 'text' },
    { sender: 'lead', text: '30 Minuten', kind: 'text' },
  ];
  const result = analyzeTrainingSignals(messages);
  assert.equal(result.hasTemporalWish, true);
  assert.equal(result.hasDuration, true);
  assert.equal(result.nextMissing, null);
});

test('guidance uses profile facts and never treats history as a facts source', () => {
  const profile = {
    name: 'Test',
    price_text: '30 Minuten: 80',
    hours_text: '10-22 Uhr',
    location: 'Teststraße 1',
  };
  const messages = [{ sender: 'lead', text: 'Was kostet es?', kind: 'text' }];
  const guidance = buildTrainingGuidance(profile, messages);
  assert.match(guidance, /Historische Muster sind nur Ablaufhilfe, niemals Faktenquelle/);
  assert.match(guidance, /30 Minuten: 80/);
  assert.match(guidance, /Nächster fehlender Slot: Zeitwunsch/);
});
