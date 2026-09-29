import assert from 'node:assert/strict';
import test from 'node:test';
import { applyCallEvent } from '../src/calls/domain/apply-call-event';
import type { callAttemptSnapshot, callEvent } from '../src/calls/domain/call-event';

const baseAttempt: callAttemptSnapshot = {
  id: 'a',
  orgId: 'o',
  status: 'queued',
  startedAt: null,
  endedAt: null,
  lastSequence: null
};

function event(overrides: Partial<callEvent>): callEvent {
  return {
    eventId: 'e',
    callId: 'c',
    sequence: 1n,
    type: 'call.queued',
    occurredAt: new Date('2026-09-29T10:00:00Z'),
    data: {},
    rawPayload: '{}',
    correlationId: 'corr',
    ...overrides
  };
}

test('older events never roll status back', () => {
  const patch = applyCallEvent({ ...baseAttempt, status: 'in_progress', lastSequence: 3n }, event({
    sequence: 2n,
    type: 'call.dialing'
  }));
  assert.deepEqual(patch, {});
});

test('first terminal state remains final even for newer events', () => {
  const patch = applyCallEvent({
    ...baseAttempt,
    status: 'completed',
    endedAt: new Date('2026-09-29T10:05:00Z'),
    lastSequence: 3n
  }, event({ sequence: 4n, type: 'call.failed' }));

  assert.equal(patch.status, undefined);
  assert.equal(patch.lastSequence, 4n);
});

test('late answered fills missing startedAt without changing terminal state', () => {
  const occurredAt = new Date('2026-09-29T10:01:00Z');
  const patch = applyCallEvent({
    ...baseAttempt,
    status: 'completed',
    endedAt: new Date('2026-09-29T10:05:00Z'),
    lastSequence: 5n
  }, event({ sequence: 2n, type: 'call.answered', occurredAt }));

  assert.equal(patch.status, undefined);
  assert.equal(patch.startedAt?.toISOString(), occurredAt.toISOString());
});
