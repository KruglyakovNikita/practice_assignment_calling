import { analysisResultSchema } from '@auto-calling/contracts';
import { resolveAnalysisTranscript } from '../../domain/transcript';
import type { analysisExecutionPort } from '../ports/analysis-execution.port';
import type { analysisJob, analysisJobPort } from '../ports/analysis-job.port';
import { AnalysisProviderError, type analysisProviderPort } from '../ports/analysis-provider.port';

export type analysisProcessingConfig = {
  leaseMs: number;
  providerTimeoutMs: number;
  providerMaxRetries: number;
};

export class ProcessNextAnalysisUseCase {
  constructor(
    private readonly jobs: analysisJobPort,
    private readonly provider: analysisProviderPort,
    private readonly executions: analysisExecutionPort,
    private readonly config: analysisProcessingConfig
  ) {}

  async execute(): Promise<boolean> {
    const job = await this.jobs.claimNext(this.config.leaseMs);
    if (!job) return false;

    const signal = this.executions.register(job.id);
    const heartbeat = setInterval(() => {
      void this.jobs.renewLease(job.id, job.leaseToken, this.config.leaseMs).then((renewed) => {
        if (!renewed) this.executions.abort(job.id, 'lease_lost');
      }).catch(() => this.executions.abort(job.id, 'lease_lost'));
    }, Math.max(250, Math.min(1000, Math.floor(this.config.leaseMs / 3))));

    try {
      await this.process(job, signal);
    } finally {
      clearInterval(heartbeat);
      this.executions.unregister(job.id);
    }
    return true;
  }

  private async process(job: analysisJob, cancellationSignal: AbortSignal): Promise<void> {
    const transcript = resolveAnalysisTranscript(job.transcript);
    let chunkCount = 0;

    for (let retry = 0; retry <= this.config.providerMaxRetries; retry += 1) {
      if (cancellationSignal.aborted && cancellationSignal.reason !== 'cancelled') return;
      if (await this.shouldCancel(job, cancellationSignal)) {
        await this.jobs.cancel(job.id, job.leaseToken);
        return;
      }

      const timeout = new AbortController();
      const timeoutHandle = setTimeout(() => timeout.abort(), this.config.providerTimeoutMs);
      const signal = AbortSignal.any([cancellationSignal, timeout.signal]);

      try {
        const response = await this.provider.open({ requestId: job.id, transcript, signal });
        if (response.kind === 'rate_limited') {
          if (retry >= this.config.providerMaxRetries) {
            await this.fail(job, 'PROVIDER_RATE_LIMITED', 'Provider retry limit exceeded', chunkCount > 0);
            return;
          }
          clearTimeout(timeoutHandle);
          await waitForRetry(response.retryAfterMs, cancellationSignal);
          continue;
        }

        for await (const event of response.events) {
          if (await this.shouldCancel(job, cancellationSignal)) {
            await this.jobs.cancel(job.id, job.leaseToken);
            return;
          }

          if (event.type === 'chunk') {
            const saved = await this.jobs.appendChunk({
              analysisId: job.id,
              leaseToken: job.leaseToken,
              field: event.field,
              delta: event.delta
            });
            if (!saved) {
              if (await this.jobs.isCancellationRequested(job.id, job.leaseToken)) {
                await this.jobs.cancel(job.id, job.leaseToken);
              }
              return;
            }
            chunkCount += 1;
            continue;
          }

          const parsed = analysisResultSchema.safeParse(event.result);
          if (!parsed.success) {
            await this.fail(job, 'INVALID_PROVIDER_RESULT', 'Provider done event does not match the result schema', false);
            return;
          }

          const completed = await this.jobs.complete({
            analysisId: job.id,
            leaseToken: job.leaseToken,
            result: parsed.data
          });
          if (!completed && await this.jobs.isCancellationRequested(job.id, job.leaseToken)) {
            await this.jobs.cancel(job.id, job.leaseToken);
          }
          return;
        }

        await this.fail(job, 'PROVIDER_STREAM_ENDED', 'Provider stream ended before done event', chunkCount > 0);
        return;
      } catch (error) {
        if (await this.shouldCancel(job, cancellationSignal)) {
          await this.jobs.cancel(job.id, job.leaseToken);
          return;
        }
        if (cancellationSignal.aborted) return;

        const providerError = error instanceof AnalysisProviderError ? error : null;
        const timedOut = timeout.signal.aborted;
        await this.fail(
          job,
          timedOut ? 'PROVIDER_TIMEOUT' : providerError?.code ?? 'PROVIDER_ERROR',
          timedOut ? 'Provider request timed out' : providerError?.message ?? 'Provider request failed',
          chunkCount > 0
        );
        return;
      } finally {
        clearTimeout(timeoutHandle);
      }
    }
  }

  private async shouldCancel(job: analysisJob, signal: AbortSignal): Promise<boolean> {
    if (signal.aborted && signal.reason === 'cancelled') return true;
    return this.jobs.isCancellationRequested(job.id, job.leaseToken);
  }

  private async fail(job: analysisJob, code: string, message: string, partial: boolean): Promise<void> {
    const failed = await this.jobs.fail({
      analysisId: job.id,
      leaseToken: job.leaseToken,
      code,
      message,
      partial
    });
    if (!failed && await this.jobs.isCancellationRequested(job.id, job.leaseToken)) {
      await this.jobs.cancel(job.id, job.leaseToken);
    }
  }
}

function waitForRetry(ms: number, signal: AbortSignal): Promise<void> {
  if (signal.aborted) return Promise.resolve();
  return new Promise((resolve) => {
    const timer = setTimeout(done, ms);
    const onAbort = (): void => done();
    function done(): void {
      clearTimeout(timer);
      signal.removeEventListener('abort', onAbort);
      resolve();
    }
    signal.addEventListener('abort', onAbort, { once: true });
  });
}
