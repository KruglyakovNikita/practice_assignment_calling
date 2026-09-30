import assert from 'node:assert/strict';
import test from 'node:test';
import type { analysisExecutionPort } from '../src/analyses/application/ports/analysis-execution.port';
import type { analysisJobPort } from '../src/analyses/application/ports/analysis-job.port';
import type { analysisProviderPort } from '../src/analyses/application/ports/analysis-provider.port';
import { ProcessNextAnalysisUseCase } from '../src/analyses/application/use-cases/process-next-analysis.use-case';

const job = {
  id: '11111111-1111-4111-8111-111111111111',
  orgId: '22222222-2222-4222-8222-222222222222',
  callAttemptId: '33333333-3333-4333-8333-333333333333',
  transcript: 'hello',
  leaseToken: '44444444-4444-4444-8444-444444444444'
};

test('invalid done is error while already accumulated chunks remain persisted', async () => {
  let claimed = false;
  let chunks = 0;
  let failed: { code: string; partial: boolean } | null = null;

  const jobs: analysisJobPort = {
    claimNext: async () => claimed ? null : (claimed = true, job),
    renewLease: async () => true,
    isCancellationRequested: async () => false,
    appendChunk: async () => (chunks += 1, true),
    complete: async () => true,
    fail: async (input) => {
      failed = { code: input.code, partial: input.partial };
      return true;
    },
    cancel: async () => true,
    recoverExpired: async () => 0
  };

  const provider: analysisProviderPort = {
    open: async () => ({
      kind: 'stream',
      events: (async function* () {
        yield { type: 'chunk' as const, field: 'summary', delta: 'partial' };
        yield { type: 'done' as const, result: { summary: 123 } };
      })()
    })
  };

  const executions: analysisExecutionPort = {
    register: () => new AbortController().signal,
    abort: () => undefined,
    unregister: () => undefined
  };

  const useCase = new ProcessNextAnalysisUseCase(jobs, provider, executions, {
    leaseMs: 30_000,
    providerTimeoutMs: 5_000,
    providerMaxRetries: 0
  });

  assert.equal(await useCase.execute(), true);
  assert.equal(chunks, 1);
  assert.deepEqual(failed, { code: 'INVALID_PROVIDER_RESULT', partial: false });
});
