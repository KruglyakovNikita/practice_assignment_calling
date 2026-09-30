import type { analysisResult } from '@auto-calling/contracts';

export type analysisJob = {
  id: string;
  orgId: string;
  callAttemptId: string;
  transcript: string | null;
  leaseToken: string;
};

export interface analysisJobPort {
  claimNext(leaseMs: number): Promise<analysisJob | null>;
  renewLease(analysisId: string, leaseToken: string, leaseMs: number): Promise<boolean>;
  isCancellationRequested(analysisId: string, leaseToken: string): Promise<boolean>;
  appendChunk(input: {
    analysisId: string;
    leaseToken: string;
    field: string;
    delta: string;
  }): Promise<boolean>;
  complete(input: {
    analysisId: string;
    leaseToken: string;
    result: analysisResult;
  }): Promise<boolean>;
  fail(input: {
    analysisId: string;
    leaseToken: string;
    code: string;
    message: string;
    partial: boolean;
  }): Promise<boolean>;
  cancel(analysisId: string, leaseToken: string): Promise<boolean>;
  /** Provider answered 200 text/event-stream: from here on the job must never be re-sent. */
  markStreamStarted(analysisId: string, leaseToken: string): Promise<void>;
  /** Worker stops without a result: back to queue if the stream never started, else partial/error. */
  release(analysisId: string, leaseToken: string): Promise<void>;
  recoverExpired(limit: number): Promise<number>;
}

export const ANALYSIS_JOB_PORT = Symbol('ANALYSIS_JOB_PORT');
