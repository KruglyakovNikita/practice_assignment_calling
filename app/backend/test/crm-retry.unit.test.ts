import assert from 'node:assert/strict';
import test from 'node:test';
import type { crmClientPort } from '../src/crm/application/ports/crm-client.port';
import type { crmOutboxPort } from '../src/crm/application/ports/crm-outbox.port';
import { DeliverCrmNotificationsUseCase } from '../src/crm/application/use-cases/deliver-crm-notifications.use-case';
import { retryDelayMs } from '../src/crm/application/use-cases/retry-delay';

test('CRM failure is retried with backoff and becomes dead on the last allowed attempt', async () => {
  const marks: { dead: boolean; errorCode: string }[] = [];
  const outboxWith = (attempts: number): crmOutboxPort => ({
    leaseBatch: async () => [{ id: 'm1', leaseToken: 't1', attempts, payload: { attempt_id: 'a1' }, correlationId: null }],
    markDelivered: async () => assert.fail('must not be delivered'),
    markFailed: async (input) => { marks.push({ dead: input.dead, errorCode: input.errorCode }); }
  });
  const client: crmClientPort = { post: async () => ({ ok: false, errorCode: 'HTTP_503' }) };
  const config = { batchSize: 10, leaseMs: 1000, maxAttempts: 3, retryBaseMs: 1000, retryMaxMs: 60000 };

  await new DeliverCrmNotificationsUseCase(outboxWith(0), client, config).execute();
  await new DeliverCrmNotificationsUseCase(outboxWith(2), client, config).execute();
  assert.deepEqual(marks, [{ dead: false, errorCode: 'HTTP_503' }, { dead: true, errorCode: 'HTTP_503' }]);
});

test('CRM retry backoff is bounded', () => {
  assert.equal(retryDelayMs(0, 1000, 60000), 1000);
  assert.equal(retryDelayMs(3, 1000, 60000), 8000);
  assert.equal(retryDelayMs(20, 1000, 60000), 60000);
});
