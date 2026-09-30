import type { analysisState, analysisStorePort, tenantContext } from '../ports/analysis-store.port';
import { CallAttemptNotFoundError, CallAttemptNotReadyError } from '../analysis-errors';

export class CreateAnalysisUseCase {
  constructor(private readonly analyses: analysisStorePort) {}

  async execute(input: tenantContext & { callAttemptId: string }): Promise<analysisState> {
    const result = await this.analyses.createOrGet(input, input.callAttemptId);
    if (result.kind === 'not_found') throw new CallAttemptNotFoundError();
    if (result.kind === 'not_ready') throw new CallAttemptNotReadyError();
    return result.analysis;
  }
}
