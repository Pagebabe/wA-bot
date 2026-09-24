import type { Conversation } from './store.js';

export type ReviewCandidate = {
  reply: string;
  hot: boolean;
  score: number;
  reason: string;
};

export function isHumanGateEnabled(value = process.env.AI_HUMAN_GATE): boolean {
  return String(value || '').toLowerCase() === 'true';
}

export function pendingReviewPatch(candidate: ReviewCandidate, createdAt: string) {
  return {
    state: 'PAUSED' as const,
    pending_ai_reply: candidate.reply || '',
    pending_ai_hot: Boolean(candidate.hot),
    pending_ai_score: Number.isFinite(candidate.score) ? candidate.score : 0,
    pending_ai_reason: candidate.reason || '',
    pending_ai_created_at: createdAt,
  };
}

export function clearPendingReviewPatch() {
  return {
    pending_ai_reply: null,
    pending_ai_hot: null,
    pending_ai_score: null,
    pending_ai_reason: null,
    pending_ai_created_at: null,
  };
}

export function reviewMatches(conversation: Conversation, expectedCreatedAt: string | null | undefined): boolean {
  const current = conversation.pending_ai_created_at || null;
  if (!current) return false;
  if (!expectedCreatedAt) return true;
  return current === expectedCreatedAt;
}
