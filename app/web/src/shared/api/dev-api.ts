const apiUrl = (import.meta.env.VITE_API_URL as string | undefined) ?? 'http://localhost:8080';

export type seedResult = { org_id: string; campaign_id: string; timezone: string; contacts: number; token: string };
export type claimedContact = { id: string; phone_e164: string; attempt_id: string };
export type callEventType = 'call.queued' | 'call.dialing' | 'call.answered' | 'call.completed' | 'call.failed' | 'call.no_answer';
export type sentWebhook = {
  event: { event_id: string; call_id: string; sequence: number; type: callEventType; occurred_at: string; data: Record<string, unknown> };
  http_status: number;
  correlation_id: string | null;
  response: { ok?: boolean; duplicate?: boolean; code?: string } | null;
};
export type attemptSnapshot = {
  attempt: {
    id: string;
    provider_call_id: string;
    status: string;
    started_at: string | null;
    ended_at: string | null;
    outcome: Record<string, unknown> | null;
    transcript: string | null;
    last_sequence: string | null;
    correlation_id: string | null;
    contact: { id: string; phone_e164: string; timezone: string; attempts_count: number; last_attempt_at: string | null; do_not_call: boolean };
  };
  webhook_events: { event_id: string; sequence: string; type: string; received_at: string; correlation_id: string }[];
  crm: { status: string; attempts: number; last_error: string | null; next_attempt_at: string; delivered_at: string | null } | null;
};

export class DevToolsDisabledError extends Error {
  constructor() {
    super('Dev-инструменты выключены: запустите API с DEV_TOOLS=true');
  }
}

export async function devToolsEnabled(): Promise<boolean> {
  try {
    return (await fetch(`${apiUrl}/dev/status`)).ok;
  } catch {
    return false;
  }
}

export const seedDemo =(contacts: number) => call<seedResult>('/dev/seed', { method: 'POST', body: { contacts } });
export const issueDevToken = (input: { orgId: string; sub: string; role: 'worker' | 'authenticated' }) =>
  call<{ token: string }>('/dev/token', { method: 'POST', body: { org_id: input.orgId, sub: input.sub, role: input.role } });
export const sendWebhook = (input: { callId: string; type: callEventType; data?: Record<string, unknown>; sequence?: number; eventId?: string }) =>
  call<sentWebhook>('/dev/webhook', {
    method: 'POST',
    body: { call_id: input.callId, type: input.type, data: input.data ?? {}, sequence: input.sequence, event_id: input.eventId }
  });
export const setTranscript = (attemptId: string, transcript: string | null) =>
  call<{ ok: true }>(`/dev/attempts/${attemptId}/transcript`, { method: 'PUT', body: { transcript } });
export const getAttempt = (attemptId: string) => call<attemptSnapshot>(`/dev/attempts/${attemptId}`);

// Real endpoint, not a dev one.
export async function claimNextContact(token: string, campaignId: string): Promise<claimedContact | null> {
  const body = await call<{ contact: claimedContact | null }>('/rpc/claim_next_contact', { method: 'POST', body: { campaign_id: campaignId }, token });
  return body.contact;
}

async function call<T>(path: string, init: { method?: string; body?: unknown; token?: string } = {}): Promise<T> {
  const response = await fetch(`${apiUrl}${path}`, {
    method: init.method ?? 'GET',
    headers: {
      'content-type': 'application/json',
      ...(init.token ? { authorization: `Bearer ${init.token}` } : {})
    },
    body: init.body === undefined ? undefined : JSON.stringify(init.body)
  });
  if (response.status === 404 && path.startsWith('/dev/') && !path.startsWith('/dev/attempts/')) throw new DevToolsDisabledError();
  if (!response.ok) throw new Error((await response.text()) || `HTTP ${response.status}`);
  return response.json() as Promise<T>;
}
