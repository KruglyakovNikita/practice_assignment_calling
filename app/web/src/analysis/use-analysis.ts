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

export type sseLogEntry = {
  at: string;
  kind: 'connect' | 'event' | 'disconnect';
  id?: string;
  event?: string;
  data?: unknown;
  note?: string;
};

export function useAnalysis() {
  const [state, setState] = useState<analysisViewState>('idle');
  const [analysisId, setAnalysisId] = useState<string | null>(null);
  const [partial, setPartial] = useState<analysisPartialResult>({});
  const [result, setResult] = useState<analysisResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [log, setLog] = useState<sseLogEntry[]>([]);
  const controllerRef = useRef<AbortController | null>(null);
  const connectionRef = useRef<AbortController | null>(null);
  const lastEventIdRef = useRef('0');
  const stateRef = useRef<analysisViewState>('idle');

  useEffect(() => () => controllerRef.current?.abort(), []);

  function changeState(next: analysisViewState): void {
    stateRef.current = next;
    setState(next);
  }

  function addLog(entry: Omit<sseLogEntry, 'at'>): void {
    setLog((current) => [...current, { ...entry, at: new Date().toLocaleTimeString() }]);
  }

  async function start(token: string, callAttemptId: string): Promise<void> {
    controllerRef.current?.abort();
    const controller = new AbortController();
    controllerRef.current = controller;
    lastEventIdRef.current = '0';
    setPartial({});
    setResult(null);
    setError(null);
    setLog([]);

    try {
      const created = await createAnalysis(token, callAttemptId);
      setAnalysisId(created.id);
      changeState(created.status);
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
    }
  }

  // Simulates a network drop of the current SSE connection; the loop reconnects with Last-Event-ID.
  function dropConnection(): void {
    connectionRef.current?.abort();
  }

  async function consume(token: string, id: string, signal: AbortSignal): Promise<void> {
    while (!signal.aborted) {
      const connection = new AbortController();
      connectionRef.current = connection;
      const connectionSignal = AbortSignal.any([signal, connection.signal]);
      const watcher = new AbortController();
      const watchPromise = watchStreamingState(token, id, AbortSignal.any([connectionSignal, watcher.signal]), changeState, stateRef);
      const resumeFrom = lastEventIdRef.current;
      addLog({ kind: 'connect', note: resumeFrom === '0' ? 'GET /stream' : `GET /stream, Last-Event-ID: ${resumeFrom}` });
      try {
        await streamAnalysis({
          token,
          analysisId: id,
          lastEventId: resumeFrom,
          signal: connectionSignal,
          onMessage: (message) => {
            if (message.id) lastEventIdRef.current = message.id;
            addLog({ kind: 'event', id: message.id, event: message.event, data: message.data });
            if (message.event === 'chunk') {
              const parsed = analysisChunkPayloadSchema.parse(message.data);
              setPartial((current) => ({ ...current, [parsed.field]: `${current[parsed.field] ?? ''}${parsed.delta}` }));
              if (!isTerminal(stateRef.current)) changeState('streaming');
              return;
            }
            if (message.event === 'done') {
              setResult(analysisDonePayloadSchema.parse(message.data).result);
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
        addLog({ kind: 'disconnect', note: 'сервер закрыл поток' });

        const current = await getAnalysis(token, id);
        setPartial(current.partial_result);
        setResult(current.result);
        if (isTerminal(current.status)) {
          changeState(current.status);
          if (current.error?.message) setError(current.error.message);
          return;
        }
        changeState('reconnecting');
      } catch (cause) {
        watcher.abort();
        await watchPromise;
        if (signal.aborted) return;
        const dropped = connection.signal.aborted;
        addLog({ kind: 'disconnect', note: dropped ? 'соединение разорвано вручную' : cause instanceof Error ? cause.message : 'ошибка сети' });
        if (!dropped) setError(cause instanceof Error ? cause.message : 'SSE соединение потеряно');
        changeState('reconnecting');
      }
      await delay(800, signal);
    }
  }

  return { state, analysisId, partial, result, error, log, start, cancel, dropConnection };
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
      if (current.status === 'streaming' && !isTerminal(stateRef.current)) changeState('streaming');
      if (isTerminal(current.status)) return;
    } catch {
      return;
    }
    await delay(250, signal);
  }
}

function isTerminal(status: analysisStatus | analysisViewState): boolean {
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
