import { useEffect, useRef, useState } from 'react';
import {
  analysisChunkPayloadSchema,
  analysisDonePayloadSchema,
  analysisErrorPayloadSchema,
  type analysisPartialResult,
  type analysisResult,
  type analysisStatus
} from '@auto-calling/contracts';
import { cancelAnalysis, createAnalysis, getAnalysis, streamAnalysis } from '../shared/api/analysis-api';

export type analysisViewState = 'idle' | 'queued' | 'streaming' | 'reconnecting' | 'partial' | 'error' | 'cancelled' | 'completed';

export function useAnalysis() {
  const [state, setState] = useState<analysisViewState>('idle');
  const [analysisId, setAnalysisId] = useState<string | null>(null);
  const [partial, setPartial] = useState<analysisPartialResult>({});
  const [result, setResult] = useState<analysisResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const controllerRef = useRef<AbortController | null>(null);
  const lastEventIdRef = useRef('0');
  const stateRef = useRef<analysisViewState>('idle');

  useEffect(() => () => controllerRef.current?.abort(), []);

  function changeState(next: analysisViewState): void {
    stateRef.current = next;
    setState(next);
  }

  async function start(token: string, callAttemptId: string): Promise<void> {
    controllerRef.current?.abort();
    const controller = new AbortController();
    controllerRef.current = controller;
    lastEventIdRef.current = '0';
    setPartial({});
    setResult(null);
    setError(null);

    try {
      const created = await createAnalysis(token, callAttemptId);
      setAnalysisId(created.id);
      changeState(toViewState(created.status));
      await consume(token, created.id, controller.signal);
    } catch (cause) {
      if (controller.signal.aborted) return;
      setError(cause instanceof Error ? cause.message : 'Не удалось запустить анализ');
      changeState('error');
    }
  }

  async function cancel(token: string): Promise<void> {
    if (!analysisId) return;
    try {
      const response = await cancelAnalysis(token, analysisId);
      if (response.status === 'cancelled') changeState('cancelled');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Не удалось отменить анализ');
      changeState('error');
    }
  }

  async function consume(token: string, id: string, signal: AbortSignal): Promise<void> {
    while (!signal.aborted) {
      const watcher = new AbortController();
      const combinedWatcherSignal = AbortSignal.any([signal, watcher.signal]);
      const watchPromise = watchStreamingState(token, id, combinedWatcherSignal, changeState, stateRef);
      try {
        await streamAnalysis({
          token,
          analysisId: id,
          lastEventId: lastEventIdRef.current,
          signal,
          onMessage: (message) => {
            if (message.id) lastEventIdRef.current = message.id;
            if (message.event === 'chunk') {
              const parsed = analysisChunkPayloadSchema.parse(message.data);
              setPartial((current) => ({
                ...current,
                [parsed.field]: `${current[parsed.field] ?? ''}${parsed.delta}`
              }));
              if (!isViewTerminal(stateRef.current)) changeState('streaming');
              return;
            }
            if (message.event === 'done') {
              const parsed = analysisDonePayloadSchema.parse(message.data);
              setResult(parsed.result);
              changeState('completed');
              return;
            }
            if (message.event === 'error') {
              const parsed = analysisErrorPayloadSchema.parse(message.data);
              setError(parsed.message);
              changeState(parsed.status);
            }
          }
        });
        watcher.abort();
        await watchPromise;

        const current = await getAnalysis(token, id);
        setPartial(current.partial_result);
        setResult(current.result);
        if (isTerminal(current.status)) {
          changeState(toViewState(current.status));
          if (current.error?.message) setError(current.error.message);
          return;
        }
        changeState('reconnecting');
      } catch (cause) {
        watcher.abort();
        await watchPromise;
        if (signal.aborted) return;
        setError(cause instanceof Error ? cause.message : 'SSE соединение потеряно');
        changeState('reconnecting');
      }
      await delay(800, signal);
    }
  }

  return { state, analysisId, partial, result, error, start, cancel };
}

async function watchStreamingState(
  token: string,
  analysisId: string,
  signal: AbortSignal,
  changeState: (state: analysisViewState) => void,
  stateRef: { current: analysisViewState }
): Promise<void> {
  while (!signal.aborted) {
    try {
      const current = await getAnalysis(token, analysisId);
      if (current.status === 'streaming' && !isViewTerminal(stateRef.current)) changeState('streaming');
      if (isTerminal(current.status)) return;
    } catch {
      return;
    }
    await delay(250, signal);
  }
}

function toViewState(status: analysisStatus): analysisViewState {
  return status;
}

function isTerminal(status: analysisStatus): boolean {
  return status === 'completed' || status === 'partial' || status === 'error' || status === 'cancelled';
}

function isViewTerminal(status: analysisViewState): boolean {
  return status === 'completed' || status === 'partial' || status === 'error' || status === 'cancelled';
}

function delay(ms: number, signal: AbortSignal): Promise<void> {
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
