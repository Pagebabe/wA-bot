import test from 'node:test';
import assert from 'node:assert/strict';
import {
  isHumanGateEnabled,
  pendingReviewPatch,
  clearPendingReviewPatch,
  reviewMatches,
} from '../dist/human-gate.js';

test('human gate only enables on explicit true', () => {
  assert.equal(isHumanGateEnabled('true'), true);
  assert.equal(isHumanGateEnabled('TRUE'), true);
  assert.equal(isHumanGateEnabled('false'), false);
  assert.equal(isHumanGateEnabled(undefined), false);
});

test('pending review pauses the conversation without sending', () => {
  const patch = pendingReviewPatch({
    reply: 'Test reply',
    hot: false,
    score: 0.61,
    reason: 'Needs review',
  }, '2026-09-24T20:30:00.000Z');
  assert.equal(patch.state, 'PAUSED');
  assert.equal(patch.pending_ai_reply, 'Test reply');
  assert.equal(patch.pending_ai_hot, false);
  assert.equal(patch.pending_ai_score, 0.61);
  assert.equal(patch.pending_ai_created_at, '2026-09-24T20:30:00.000Z');
});

test('review version prevents stale moderator approval', () => {
  const conversation = {
    pending_ai_created_at: '2026-09-24T20:30:00.000Z',
  };
  assert.equal(reviewMatches(conversation, '2026-09-24T20:30:00.000Z'), true);
  assert.equal(reviewMatches(conversation, '2026-09-24T20:29:00.000Z'), false);
  assert.equal(reviewMatches({ pending_ai_created_at: null }, null), false);
});

test('clear pending review removes all moderator-gate payload', () => {
  assert.deepEqual(clearPendingReviewPatch(), {
    pending_ai_reply: null,
    pending_ai_hot: null,
    pending_ai_score: null,
    pending_ai_reason: null,
    pending_ai_created_at: null,
  });
});
