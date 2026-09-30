export type analysisAbortReason = 'cancelled' | 'lease_lost' | 'shutdown';

export interface analysisExecutionPort {
  register(analysisId: string): AbortSignal;
  abort(analysisId: string, reason: analysisAbortReason): void;
  unregister(analysisId: string): void;
  abortAll(reason: analysisAbortReason): void;
}

export const ANALYSIS_EXECUTION_PORT = Symbol('ANALYSIS_EXECUTION_PORT');
