import { Module } from '@nestjs/common';
import type { runtimeConfig } from '../shared/config/runtime-config';
import { RUNTIME_CONFIG } from '../shared/config/config.module';
import { JwtAuthGuard } from '../shared/auth/jwt-auth.guard';
import { ANALYSIS_EXECUTION_PORT, type analysisExecutionPort } from './application/ports/analysis-execution.port';
import { ANALYSIS_JOB_PORT, type analysisJobPort } from './application/ports/analysis-job.port';
import { ANALYSIS_PROVIDER_PORT, type analysisProviderPort } from './application/ports/analysis-provider.port';
import { ANALYSIS_STORE_PORT, type analysisStorePort } from './application/ports/analysis-store.port';
import { CancelAnalysisUseCase } from './application/use-cases/cancel-analysis.use-case';
import { CreateAnalysisUseCase } from './application/use-cases/create-analysis.use-case';
import { GetAnalysisUseCase } from './application/use-cases/get-analysis.use-case';
import { ProcessNextAnalysisUseCase } from './application/use-cases/process-next-analysis.use-case';
import { RecoverStaleAnalysesUseCase } from './application/use-cases/recover-stale-analyses.use-case';
import { StreamAnalysisEventsUseCase } from './application/use-cases/stream-analysis-events.use-case';
import { AnalysesController } from './adapters/http/analyses.controller';
import { AnalysisProviderHttpClient } from './adapters/http/analysis-provider.client';
import { AnalysisJobRepository } from './adapters/sql/analysis-job.repository';
import { AnalysisStoreRepository } from './adapters/sql/analysis-store.repository';
import { AnalysisWorker } from './adapters/worker/analysis.worker';
import { InMemoryAnalysisExecutionRegistry } from './adapters/worker/in-memory-analysis-execution.registry';

@Module({
  controllers: [AnalysesController],
  providers: [
    JwtAuthGuard,
    AnalysisStoreRepository,
    AnalysisJobRepository,
    AnalysisProviderHttpClient,
    InMemoryAnalysisExecutionRegistry,
    { provide: ANALYSIS_STORE_PORT, useExisting: AnalysisStoreRepository },
    { provide: ANALYSIS_JOB_PORT, useExisting: AnalysisJobRepository },
    { provide: ANALYSIS_PROVIDER_PORT, useExisting: AnalysisProviderHttpClient },
    { provide: ANALYSIS_EXECUTION_PORT, useExisting: InMemoryAnalysisExecutionRegistry },
    {
      provide: CreateAnalysisUseCase,
      inject: [ANALYSIS_STORE_PORT],
      useFactory: (store: analysisStorePort) => new CreateAnalysisUseCase(store)
    },
    {
      provide: GetAnalysisUseCase,
      inject: [ANALYSIS_STORE_PORT],
      useFactory: (store: analysisStorePort) => new GetAnalysisUseCase(store)
    },
    {
      provide: CancelAnalysisUseCase,
      inject: [ANALYSIS_STORE_PORT, ANALYSIS_EXECUTION_PORT],
      useFactory: (store: analysisStorePort, execution: analysisExecutionPort) =>
        new CancelAnalysisUseCase(store, execution)
    },
    {
      provide: StreamAnalysisEventsUseCase,
      inject: [ANALYSIS_STORE_PORT, RUNTIME_CONFIG],
      useFactory: (store: analysisStorePort, config: runtimeConfig) =>
        new StreamAnalysisEventsUseCase(store, config.analysisSsePollMs)
    },
    {
      provide: ProcessNextAnalysisUseCase,
      inject: [ANALYSIS_JOB_PORT, ANALYSIS_PROVIDER_PORT, ANALYSIS_EXECUTION_PORT, RUNTIME_CONFIG],
      useFactory: (
        jobs: analysisJobPort,
        provider: analysisProviderPort,
        execution: analysisExecutionPort,
        config: runtimeConfig
      ) => new ProcessNextAnalysisUseCase(jobs, provider, execution, {
        leaseMs: config.analysisLeaseMs,
        providerTimeoutMs: config.analysisProviderTimeoutMs,
        providerMaxRetries: config.analysisProviderMaxRetries
      })
    },
    {
      provide: RecoverStaleAnalysesUseCase,
      inject: [ANALYSIS_JOB_PORT, RUNTIME_CONFIG],
      useFactory: (jobs: analysisJobPort, config: runtimeConfig) =>
        new RecoverStaleAnalysesUseCase(jobs, config.analysisRecoveryBatchSize)
    },
    AnalysisWorker
  ]
})
export class AnalysesModule {}
