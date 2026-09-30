import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { DeliverCrmNotificationsUseCase } from '../../application/use-cases/deliver-crm-notifications.use-case';
import type { runtimeConfig } from '../../../shared/config/runtime-config';
import { Inject } from '@nestjs/common';
import { RUNTIME_CONFIG } from '../../../shared/config/config.module';

@Injectable()
export class CrmOutboxWorker implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(CrmOutboxWorker.name);
  private timer: NodeJS.Timeout | null = null;
  private current: Promise<void> | null = null;
  private stopping = false;

  constructor(
    private readonly deliver: DeliverCrmNotificationsUseCase,
    @Inject(RUNTIME_CONFIG) private readonly config: runtimeConfig
  ) {}

  onModuleInit(): void {
    this.timer = setInterval(() => this.tick(), this.config.crmPollMs);
    this.tick();
  }

  // Graceful stop: no new batches, but deliveries already sent to the CRM get their result
  // recorded, so a restart does not re-send them (at-least-once only after a hard kill).
  async onModuleDestroy(): Promise<void> {
    this.stopping = true;
    if (this.timer) clearInterval(this.timer);
    await this.current;
  }

  private tick(): void {
    if (this.current || this.stopping) return;
    this.current = this.deliver.execute()
      .catch((error) => this.logger.error(error instanceof Error ? error.message : 'CRM outbox tick failed'))
      .finally(() => { this.current = null; });
  }
}
