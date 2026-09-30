import type { analysisPartialResult, analysisResult, analysisStatus } from '@auto-calling/contracts';
import { readSse, type sseMessage } from './sse';

const apiUrl = (import.meta.env.VITE_API_URL as string | undefined) ?? 'http://localhost:8080';

export type analysisStateResponse = {
  id: string;
  call_attempt_id: string;
  status: analysisStatus;
  partial_result: analysisPartialResult;
  result: analysisResult | null;
  error: { code: string; message: string | null } | null;
  cancel_requested: boolean;
};

export async function createAnalysis(token: string, callAttemptId: string): Promise<{ id: string; status: analysisStatus }> {
  return request('/api/analyses', token, {
    method: 'POST',
    body: JSON.stringify({ call_attempt_id: callAttemptId })
  });
}

export async function getAnalysis(token: string, analysisId: string): Promise<analysisStateResponse> {
  return request(`/api/analyses/${analysisId}`, token);
}

export async function cancelAnalysis(token: string, analysisId: string): Promise<{ id: string; status: analysisStatus }> {
  return request(`/api/analyses/${analysisId}/cancel`, token, { method: 'POST' });
}

export async function streamAnalysis(input: {
  token: string;
  analysisId: string;
  lastEventId: string;
  signal: AbortSignal;
  onMessage: (message: sseMessage) => void;
}): Promise<void> {
  const response = await fetch(`${apiUrl}/api/analyses/${input.analysisId}/stream`, {
    headers: {
      authorization: `Bearer ${input.token}`,
      accept: 'text/event-stream',
      ...(input.lastEventId !== '0' ? { 'last-event-id': input.lastEventId } : {})
    },
    signal: input.signal
  });
  if (!response.ok) throw await apiError(response);
  await readSse(response, input.signal, input.onMessage);
}

async function request<T>(path: string, token: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(`${apiUrl}${path}`, {
    ...init,
    headers: {
      authorization: `Bearer ${token}`,
      'content-type': 'application/json',
      ...init.headers
    }
  });
  if (!response.ok) throw await apiError(response);
  return response.json() as Promise<T>;
}

async function apiError(response: Response): Promise<Error> {
  const body = await response.text();
  return new Error(body || `HTTP ${response.status}`);
}
