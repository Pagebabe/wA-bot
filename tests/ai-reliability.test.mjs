import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const ai = readFileSync('src/ai.ts', 'utf8');

test('LLM calls have a bounded timeout and one retry', () => {
  assert.match(ai, /const LLM_ATTEMPT_TIMEOUT_MS = 50_000/);
  assert.match(ai, /const LLM_MAX_ATTEMPTS = 2/);
  assert.match(ai, /signal: AbortSignal\.timeout\(LLM_ATTEMPT_TIMEOUT_MS\)/);
  assert.match(ai, /isRetryableStatus\(response\.status\)/);
});

test('lead qualification keeps responses compact', () => {
  assert.match(ai, /max_tokens: 220/);
  assert.match(ai, /fetchLlm\(`\$\{normalizeBaseUrl\(base\)\}\/chat\/completions`/);
});
