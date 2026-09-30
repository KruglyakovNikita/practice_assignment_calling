import { AnalysisNotFoundError } from '../analysis-errors';
import type { analysisJournalEvent, analysisStorePort, tenantContext } from '../ports/analysis-store.port';

export type streamAnalysisEvent = analysisJournalEvent;

export class StreamAnalysisEventsUseCase {
  constructor(
    private readonly analyses: analysisStorePort,
    private readonly pollMs: number
  ) {}

  async *execute(input: tenantContext & {
    analysisId: string;
    afterId: string;
    signal: AbortSignal;
  }): AsyncGenerator<streamAnalysisEvent> {
    const initial = await this.analyses.findById(input, input.analysisId);
    if (!initial) throw new AnalysisNotFoundError();

    let cursor = input.afterId;
    while (!input.signal.aborted) {
      const events = await this.analyses.listEventsAfter(input, input.analysisId, cursor, 100);
      for (const event of events) {
        cursor = event.id;
        yield event.type === 'chunk'
          ? { ...event, payload: { ...event.payload, id: event.id } }
          : event;
        if (event.type === 'done' || event.type === 'error') return;
      }

      if (events.length === 0) {
        const state = await this.analyses.findById(input, input.analysisId);
        if (!state || ['completed', 'partial', 'error', 'cancelled'].includes(state.status)) return;
        await wait(this.pollMs, input.signal);
      }
    }
  }
}

function wait(ms: number, signal: AbortSignal): Promise<void> {
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
