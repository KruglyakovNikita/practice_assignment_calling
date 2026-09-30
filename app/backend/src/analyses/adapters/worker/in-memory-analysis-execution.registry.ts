import { Injectable, OnModuleDestroy } from '@nestjs/common';
import type { analysisAbortReason, analysisExecutionPort } from '../../application/ports/analysis-execution.port';

@Injectable()
export class InMemoryAnalysisExecutionRegistry implements analysisExecutionPort, OnModuleDestroy {
  private readonly controllers = new Map<string, AbortController>();

  register(analysisId: string): AbortSignal {
    const controller = new AbortController();
    this.controllers.set(analysisId, controller);
    return controller.signal;
  }

  abort(analysisId: string, reason: analysisAbortReason): void {
    this.controllers.get(analysisId)?.abort(reason);
  }

  unregister(analysisId: string): void {
    this.controllers.delete(analysisId);
  }

  onModuleDestroy(): void {
    for (const controller of this.controllers.values()) controller.abort('shutdown');
    this.controllers.clear();
  }
}
