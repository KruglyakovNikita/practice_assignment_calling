import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { DeliverCrmNotificationsUseCase } from '../../application/use-cases/deliver-crm-notifications.use-case';
import type { runtimeConfig } from '../../../shared/config/runtime-config';
import { Inject } from '@nestjs/common';
import { RUNTIME_CONFIG } from '../../../shared/config/config.module';

@Injectable()
export class CrmOutboxWorker implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(CrmOutboxWorker.name);
  private timer: NodeJS.Timeout | null = null;
  private running = false;

  constructor(
    private readonly deliver: DeliverCrmNotificationsUseCase,
    @Inject(RUNTIME_CONFIG) private readonly config: runtimeConfig
  ) {}

  onModuleInit(): void {
    this.timer = setInterval(() => void this.tick(), this.config.crmPollMs);
    void this.tick();
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  private async tick(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      await this.deliver.execute();
    } catch (error) {
      this.logger.error(error instanceof Error ? error.message : 'CRM outbox tick failed');
    } finally {
      this.running = false;
    }
  }
}
