import { Inject, Injectable } from '@nestjs/common';
import type { runtimeConfig } from '../../../shared/config/runtime-config';
import { RUNTIME_CONFIG } from '../../../shared/config/config.module';
import {
  AnalysisProviderError,
  type analysisProviderPort,
  type analysisProviderResponse
} from '../../application/ports/analysis-provider.port';
import { parseProviderSse } from './provider-sse-parser';

@Injectable()
export class AnalysisProviderHttpClient implements analysisProviderPort {
  constructor(@Inject(RUNTIME_CONFIG) private readonly config: runtimeConfig) {}

  async open(input: {
    requestId: string;
    transcript: string;
    signal: AbortSignal;
  }): Promise<analysisProviderResponse> {
    let response: Response;
    try {
      response = await fetch(`${this.config.providerUrl.replace(/\/$/, '')}/v1/analyze`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ request_id: input.requestId, transcript: input.transcript }),
        signal: input.signal
      });
    } catch (error) {
      if (input.signal.aborted) throw error;
      throw new AnalysisProviderError('PROVIDER_NETWORK_ERROR', 'Provider request failed');
    }

    if (response.status === 429) {
      await response.body?.cancel().catch(() => undefined);
      const retryAfter = response.headers.get('retry-after');
      const seconds = retryAfter === null ? Number.NaN : Number(retryAfter);
      if (!Number.isFinite(seconds) || seconds < 0) {
        throw new AnalysisProviderError('INVALID_RETRY_AFTER', 'Provider returned invalid Retry-After');
      }
      return { kind: 'rate_limited', retryAfterMs: Math.ceil(seconds * 1000) };
    }

    if (!response.ok) {
      await response.body?.cancel().catch(() => undefined);
      throw new AnalysisProviderError(`PROVIDER_HTTP_${response.status}`, `Provider returned HTTP ${response.status}`);
    }

    if (!response.headers.get('content-type')?.toLowerCase().includes('text/event-stream') || !response.body) {
      await response.body?.cancel().catch(() => undefined);
      throw new AnalysisProviderError('INVALID_PROVIDER_RESPONSE', 'Provider response is not an SSE stream');
    }

    return { kind: 'stream', events: parseProviderSse(response.body) };
  }
}
