export type providerChunk = {
  type: 'chunk';
  field: string;
  delta: string;
};

export type providerDone = {
  type: 'done';
  result: unknown;
};

export type providerEvent = providerChunk | providerDone;

export type analysisProviderResponse =
  | { kind: 'rate_limited'; retryAfterMs: number }
  | { kind: 'stream'; events: AsyncIterable<providerEvent> };

export class AnalysisProviderError extends Error {
  constructor(
    readonly code: string,
    message: string
  ) {
    super(message);
    this.name = 'AnalysisProviderError';
  }
}

export interface analysisProviderPort {
  open(input: {
    requestId: string;
    transcript: string;
    signal: AbortSignal;
  }): Promise<analysisProviderResponse>;
}

export const ANALYSIS_PROVIDER_PORT = Symbol('ANALYSIS_PROVIDER_PORT');
