import assert from 'node:assert/strict';
import test from 'node:test';
import { analysisResultSchema } from '@auto-calling/contracts';

const valid = { summary: 'ok', objections: ['дорого'], next_step: 'call_back', lead_score: 50, confidence: 0.5 };

test('result schema accepts boundaries of the task contract (7.3)', () => {
  for (const result of [
    valid,
    { ...valid, objections: [] },
    { ...valid, lead_score: 0, confidence: 0 },
    { ...valid, lead_score: 100, confidence: 1 },
    ...['call_back', 'send_proposal', 'disqualify', 'escalate'].map((next_step) => ({ ...valid, next_step }))
  ]) {
    assert.equal(analysisResultSchema.safeParse(result).success, true, JSON.stringify(result));
  }
});

test('result schema rejects every kind of contract violation', () => {
  const { summary: _summary, ...withoutSummary } = valid;
  const { next_step: _next, ...withoutNextStep } = valid;
  const invalid: [string, unknown][] = [
    ['null result', null],
    ['array instead of object', [valid]],
    ['missing summary', withoutSummary],
    ['missing next_step', withoutNextStep],
    ['summary not a string', { ...valid, summary: 42 }],
    ['objections not an array', { ...valid, objections: 'дорого' }],
    ['objections with a non-string', { ...valid, objections: ['ok', 1] }],
    ['next_step outside the enum', { ...valid, next_step: 'call_me_maybe' }],
    ['lead_score above 100', { ...valid, lead_score: 150 }],
    ['lead_score below 0', { ...valid, lead_score: -1 }],
    ['lead_score not an integer', { ...valid, lead_score: 50.5 }],
    ['lead_score as a string', { ...valid, lead_score: '80' }],
    ['confidence above 1', { ...valid, confidence: 1.2 }],
    ['confidence below 0', { ...valid, confidence: -0.1 }],
    ['confidence as a string', { ...valid, confidence: '0.5' }],
    ['unknown extra field', { ...valid, sentiment: 'positive' }]
  ];
  for (const [label, result] of invalid) {
    assert.equal(analysisResultSchema.safeParse(result).success, false, label);
  }
});
