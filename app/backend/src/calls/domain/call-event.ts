export const callEventTypes = [
  'call.queued',
  'call.dialing',
  'call.answered',
  'call.completed',
  'call.failed',
  'call.no_answer'
] as const;

export type callEventType = (typeof callEventTypes)[number];
export type callAttemptStatus = 'queued' | 'dialing' | 'in_progress' | 'completed' | 'failed' | 'no_answer';

export type callEvent = {
  eventId: string;
  callId: string;
  sequence: bigint;
  type: callEventType;
  occurredAt: Date;
  data: Record<string, unknown>;
  rawPayload: string;
  correlationId: string;
};

export type callAttemptSnapshot = {
  id: string;
  orgId: string;
  status: callAttemptStatus;
  startedAt: Date | null;
  endedAt: Date | null;
  lastSequence: bigint | null;
};

export type callAttemptPatch = {
  status?: callAttemptStatus;
  startedAt?: Date;
  endedAt?: Date;
  outcome?: Record<string, unknown>;
  lastSequence?: bigint;
  correlationId?: string;
};
