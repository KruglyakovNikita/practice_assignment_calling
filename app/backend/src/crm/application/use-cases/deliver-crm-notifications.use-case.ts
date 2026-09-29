import type { crmClientPort } from '../ports/crm-client.port';
import type { crmOutboxPort, leasedCrmMessage } from '../ports/crm-outbox.port';
import { retryDelayMs } from './retry-delay';

export type crmDeliveryConfig = {
  batchSize: number;
  leaseMs: number;
  maxAttempts: number;
  retryBaseMs: number;
  retryMaxMs: number;
};

export class DeliverCrmNotificationsUseCase {
  constructor(
    private readonly outbox: crmOutboxPort,
    private readonly client: crmClientPort,
    private readonly config: crmDeliveryConfig
  ) {}

  async execute(): Promise<void> {
    const messages = await this.outbox.leaseBatch(this.config.batchSize, this.config.leaseMs);
    await Promise.all(messages.map((message) => this.deliver(message)));
  }

  private async deliver(message: leasedCrmMessage): Promise<void> {
    const result = await this.client.post({
      payload: message.payload,
      correlationId: message.correlationId
    });

    if (result.ok) {
      await this.outbox.markDelivered(message.id, message.leaseToken);
      return;
    }

    const nextAttemptNumber = message.attempts + 1;
    const dead = nextAttemptNumber >= this.config.maxAttempts;
    const delay = retryDelayMs(nextAttemptNumber - 1, this.config.retryBaseMs, this.config.retryMaxMs);
    await this.outbox.markFailed({
      id: message.id,
      leaseToken: message.leaseToken,
      errorCode: result.errorCode,
      retryAt: new Date(Date.now() + delay),
      dead
    });
  }
}
