import { AnalysisNotFoundError } from '../analysis-errors';
import type { analysisState, analysisStorePort, tenantContext } from '../ports/analysis-store.port';

export class GetAnalysisUseCase {
  constructor(private readonly analyses: analysisStorePort) {}

  async execute(input: tenantContext & { analysisId: string }): Promise<analysisState> {
    const analysis = await this.analyses.findById(input, input.analysisId);
    if (!analysis) throw new AnalysisNotFoundError();
    return analysis;
  }
}
