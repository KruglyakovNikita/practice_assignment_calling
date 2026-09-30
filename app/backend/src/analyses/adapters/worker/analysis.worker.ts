import { Inject, Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { RUNTIME_CONFIG } from '../../../shared/config/config.module';
import type { runtimeConfig } from '../../../shared/config/runtime-config';
import { ProcessNextAnalysisUseCase } from '../../application/use-cases/process-next-analysis.use-case';
import { RecoverStaleAnalysesUseCase } from '../../application/use-cases/recover-stale-analyses.use-case';

@Injectable()
export class AnalysisWorker implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(AnalysisWorker.name);
  private timer: NodeJS.Timeout | null = null;
  private inFlight = 0;
  private recovering = false;

  constructor(
    private readonly processNext: ProcessNextAnalysisUseCase,
    private readonly recoverStale: RecoverStaleAnalysesUseCase,
    @Inject(RUNTIME_CONFIG) private readonly config: runtimeConfig
  ) {}

  onModuleInit(): void {
    this.timer = setInterval(() => this.tick(), this.config.analysisPollMs);
    this.tick();
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  private tick(): void {
    if (!this.recovering) {
      this.recovering = true;
      void this.recoverStale.execute()
        .catch((error) => this.logError(error, 'Analysis recovery failed'))
        .finally(() => { this.recovering = false; });
    }

    const available = this.config.analysisConcurrency - this.inFlight;
    for (let slot = 0; slot < available; slot += 1) {
      this.inFlight += 1;
      void this.processNext.execute()
        .catch((error) => this.logError(error, 'Analysis processing failed'))
        .finally(() => { this.inFlight -= 1; });
    }
  }

  private logError(error: unknown, fallback: string): void {
    this.logger.error(error instanceof Error ? error.message : fallback);
  }
}
