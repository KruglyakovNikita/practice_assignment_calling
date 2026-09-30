import type { analysisPartialResult, analysisResult, analysisStatus } from '@auto-calling/contracts';

export type tenantContext = {
  orgId: string;
  tenantToken: string;
};

export type analysisState = {
  id: string;
  callAttemptId: string;
  status: analysisStatus;
  partialResult: analysisPartialResult;
  result: analysisResult | null;
  errorCode: string | null;
  errorMessage: string | null;
  cancelRequested: boolean;
  createdAt: Date;
  updatedAt: Date;
};

export type analysisJournalEvent = {
  id: string;
  type: 'chunk' | 'done' | 'error';
  payload: Record<string, unknown>;
};

export type createAnalysisResult =
  | { kind: 'created' | 'existing'; analysis: analysisState }
  | { kind: 'not_found' }
  | { kind: 'not_ready' };

export interface analysisStorePort {
  createOrGet(context: tenantContext, callAttemptId: string): Promise<createAnalysisResult>;
  findById(context: tenantContext, analysisId: string): Promise<analysisState | null>;
  requestCancel(context: tenantContext, analysisId: string): Promise<analysisState | null>;
  listEventsAfter(context: tenantContext, analysisId: string, afterId: string, limit: number): Promise<analysisJournalEvent[]>;
}

export const ANALYSIS_STORE_PORT = Symbol('ANALYSIS_STORE_PORT');
