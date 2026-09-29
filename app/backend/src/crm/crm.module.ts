import { Module } from '@nestjs/common';
import type { runtimeConfig } from '../shared/config/runtime-config';
import { RUNTIME_CONFIG } from '../shared/config/config.module';
import { CRM_CLIENT_PORT, type crmClientPort } from './application/ports/crm-client.port';
import { CRM_OUTBOX_PORT, type crmOutboxPort } from './application/ports/crm-outbox.port';
import { DeliverCrmNotificationsUseCase } from './application/use-cases/deliver-crm-notifications.use-case';
import { CrmOutboxWorker } from './adapters/cron/crm-outbox.worker';
import { CrmHttpClient } from './adapters/http/crm-http.client';
import { CrmOutboxRepository } from './adapters/sql/crm-outbox.repository';

@Module({
  providers: [
    CrmHttpClient,
    CrmOutboxRepository,
    { provide: CRM_CLIENT_PORT, useExisting: CrmHttpClient },
    { provide: CRM_OUTBOX_PORT, useExisting: CrmOutboxRepository },
    {
      provide: DeliverCrmNotificationsUseCase,
      inject: [CRM_OUTBOX_PORT, CRM_CLIENT_PORT, RUNTIME_CONFIG],
      useFactory: (outbox: crmOutboxPort, client: crmClientPort, config: runtimeConfig) =>
        new DeliverCrmNotificationsUseCase(outbox, client, {
          batchSize: config.crmBatchSize,
          leaseMs: config.crmLeaseMs,
          maxAttempts: config.crmMaxAttempts,
          retryBaseMs: config.crmRetryBaseMs,
          retryMaxMs: config.crmRetryMaxMs
        })
    },
    CrmOutboxWorker
  ]
})
export class CrmModule {}
