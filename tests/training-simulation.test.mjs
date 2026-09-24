import test from 'node:test';
import assert from 'node:assert/strict';
import { buildSimulationScenarios } from '../dist/training-simulation.js';

test('lead training simulation contains exactly 30 independent cases', () => {
  const rows = buildSimulationScenarios();
  assert.equal(rows.length, 30);
  assert.equal(new Set(rows.map((row) => row.id)).size, 30);
  assert.equal(rows.filter((row) => row.persona === 'cambodia').length, 15);
  assert.equal(rows.filter((row) => row.persona === 'kenya').length, 15);
});

test('every simulation has at least one lead turn', () => {
  for (const row of buildSimulationScenarios()) {
    assert.ok(row.turns.length >= 1);
    assert.ok(row.turns.every((turn) => typeof turn === 'string' && turn.trim().length > 0));
  }
});

test('lifecycle suite covers arrivals, explicit aborts and stalls', () => {
  const rows = buildSimulationScenarios();
  assert.equal(rows.filter((row) => row.outcome === 'arrived').length, 12);
  assert.equal(rows.filter((row) => row.outcome === 'aborted').length, 8);
  assert.equal(rows.filter((row) => row.outcome === 'stalled').length, 10);
  assert.ok(rows.some((row) => row.id.includes('keine-zusage')));
  assert.ok(rows.some((row) => row.id.includes('abbruch')));
});
