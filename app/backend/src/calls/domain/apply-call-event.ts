import type { callAttemptPatch, callAttemptSnapshot, callAttemptStatus, callEvent } from './call-event';

const terminalStatuses = new Set<callAttemptStatus>(['completed', 'failed', 'no_answer']);
const nonTerminalRank: Record<'queued' | 'dialing' | 'in_progress', number> = {
  queued: 0,
  dialing: 1,
  in_progress: 2
};

function targetStatus(type: callEvent['type']): callAttemptStatus {
  switch (type) {
    case 'call.queued': return 'queued';
    case 'call.dialing': return 'dialing';
    case 'call.answered': return 'in_progress';
    case 'call.completed': return 'completed';
    case 'call.failed': return 'failed';
    case 'call.no_answer': return 'no_answer';
  }
}

export function applyCallEvent(attempt: callAttemptSnapshot, event: callEvent): callAttemptPatch {
  const patch: callAttemptPatch = {};
  const target = targetStatus(event.type);
  const currentSequence = attempt.lastSequence ?? -1n;
  const isNewer = event.sequence > currentSequence;
  const isTerminal = terminalStatuses.has(attempt.status);

  if (event.type === 'call.answered' && attempt.startedAt === null) {
    patch.startedAt = event.occurredAt;
  }

  if (!isNewer) {
    return patch;
  }

  patch.lastSequence = event.sequence;
  patch.correlationId = event.correlationId;

  if (isTerminal) {
    return patch;
  }

  if (terminalStatuses.has(target)) {
    patch.status = target;
    patch.endedAt = event.occurredAt;
    patch.outcome = event.data;
    return patch;
  }

  const currentRank = nonTerminalRank[attempt.status as keyof typeof nonTerminalRank];
  const targetRank = nonTerminalRank[target as keyof typeof nonTerminalRank];
  if (targetRank >= currentRank) {
    patch.status = target;
  }

  return patch;
}
