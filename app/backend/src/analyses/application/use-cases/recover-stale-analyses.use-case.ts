import type { analysisJobPort } from '../ports/analysis-job.port';

export class RecoverStaleAnalysesUseCase {
  constructor(
    private readonly jobs: analysisJobPort,
    private readonly batchSize: number
  ) {}

  execute(): Promise<number> {
    return this.jobs.recoverExpired(this.batchSize);
  }
}
