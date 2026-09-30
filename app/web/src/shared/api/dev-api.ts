const apiUrl = (import.meta.env.VITE_API_URL as string | undefined) ?? 'http://localhost:8080';

export async function issueDevToken(input: { orgId: string; sub: string; role: 'worker' | 'authenticated' }): Promise<string> {
  const response = await fetch(`${apiUrl}/dev/token`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ org_id: input.orgId, sub: input.sub, role: input.role })
  });
  if (!response.ok) throw await apiError(response);
  const body = (await response.json()) as { token: string };
  return body.token;
}

export async function claimNextContact(token: string, campaignId: string): Promise<{ id: string; phone_e164: string; attempt_id: string } | null> {
  const response = await fetch(`${apiUrl}/rpc/claim_next_contact`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${token}`,
      'content-type': 'application/json'
    },
    body: JSON.stringify({ campaign_id: campaignId })
  });
  if (!response.ok) throw await apiError(response);
  const body = (await response.json()) as { contact: { id: string; phone_e164: string; attempt_id: string } | null };
  return body.contact;
}

async function apiError(response: Response): Promise<Error> {
  const body = await response.text();
  return new Error(body || `HTTP ${response.status}`);
}
