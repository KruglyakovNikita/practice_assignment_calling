import { AnalysisNotFoundError } from '../analysis-errors';
import type { analysisExecutionPort } from '../ports/analysis-execution.port';
import type { analysisState, analysisStorePort, tenantContext } from '../ports/analysis-store.port';

export class CancelAnalysisUseCase {
  constructor(
    private readonly analyses: analysisStorePort,
    private readonly executions: analysisExecutionPort
  ) {}

  async execute(input: tenantContext & { analysisId: string }): Promise<analysisState> {
    const analysis = await this.analyses.requestCancel(input, input.analysisId);
    if (!analysis) throw new AnalysisNotFoundError();

    if (analysis.cancelRequested && analysis.status === 'streaming') {
      this.executions.abort(analysis.id, 'cancelled');
    }

    return analysis;
  }
}
