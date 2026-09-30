import { Inject, Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { RUNTIME_CONFIG } from '../../../shared/config/config.module';
import type { runtimeConfig } from '../../../shared/config/runtime-config';
import { ProcessNextAnalysisUseCase } from '../../application/use-cases/process-next-analysis.use-case';
import { ANALYSIS_EXECUTION_PORT, type analysisExecutionPort } from '../../application/ports/analysis-execution.port';
import { RecoverStaleAnalysesUseCase } from '../../application/use-cases/recover-stale-analyses.use-case';

@Injectable()
export class AnalysisWorker implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(AnalysisWorker.name);
  private timer: NodeJS.Timeout | null = null;
  private readonly inFlight = new Set<Promise<unknown>>();
  private stopping = false;
  private recovering = false;

  constructor(
    private readonly processNext: ProcessNextAnalysisUseCase,
    private readonly recoverStale: RecoverStaleAnalysesUseCase,
    @Inject(ANALYSIS_EXECUTION_PORT) private readonly executions: analysisExecutionPort,
    @Inject(RUNTIME_CONFIG) private readonly config: runtimeConfig
  ) {}

  onModuleInit(): void {
    this.timer = setInterval(() => this.tick(), this.config.analysisPollMs);
    this.tick();
  }

  // Graceful stop: let running analyses finish within the grace period, then abort the rest
  // with reason 'shutdown' (the use case releases them: re-queue or partial/error).
  async onModuleDestroy(): Promise<void> {
    this.stopping = true;
    if (this.timer) clearInterval(this.timer);
    const running = Promise.allSettled([...this.inFlight]);
    const grace = new Promise((resolve) => setTimeout(resolve, this.config.analysisShutdownGraceMs).unref());
    await Promise.race([running, grace]);
    this.executions.abortAll('shutdown');
    await Promise.allSettled([...this.inFlight]);
  }

  private tick(): void {
    if (this.stopping) return;
    if (!this.recovering) {
      this.recovering = true;
      void this.recoverStale.execute()
        .catch((error) => this.logError(error, 'Analysis recovery failed'))
        .finally(() => { this.recovering = false; });
    }

    const available = this.config.analysisConcurrency - this.inFlight.size;
    for (let slot = 0; slot < available; slot += 1) {
      const run: Promise<unknown> = this.processNext.execute()
        .catch((error) => this.logError(error, 'Analysis processing failed'))
        .finally(() => { this.inFlight.delete(run); });
      this.inFlight.add(run);
    }
  }

  private logError(error: unknown, fallback: string): void {
    this.logger.error(error instanceof Error ? error.message : fallback);
  }
}
