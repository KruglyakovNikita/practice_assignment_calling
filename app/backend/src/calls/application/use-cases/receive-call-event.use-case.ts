import type { callEventPort, receiveCallEventResult } from '../ports/call-event.port';
import type { callEvent } from '../../domain/call-event';

export class ReceiveCallEventUseCase {
  constructor(private readonly events: callEventPort) {}

  execute(event: callEvent): Promise<receiveCallEventResult> {
    return this.events.receive(event);
  }
}
