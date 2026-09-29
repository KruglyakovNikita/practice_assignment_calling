import type { callEvent } from '../../domain/call-event';

export type receiveCallEventResult = {
  duplicate: boolean;
};

export class CallNotFoundError extends Error {
  constructor() {
    super('Call attempt not found');
    this.name = 'CallNotFoundError';
  }
}

export interface callEventPort {
  receive(event: callEvent): Promise<receiveCallEventResult>;
}

export const CALL_EVENT_PORT = Symbol('CALL_EVENT_PORT');
