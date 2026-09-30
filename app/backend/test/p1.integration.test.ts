import assert from 'node:assert/strict';
import { createServer, type ServerResponse } from 'node:http';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { config as loadEnv } from 'dotenv';
import { sign } from 'jsonwebtoken';
import { Pool } from 'pg';
import { resolve } from 'node:path';

loadEnv({ path: resolve(process.cwd(), '../../.env') });

const apiUrl = process.env.API_URL ?? 'http://127.0.0.1:8080';
const adminUrl = process.env.DATABASE_ADMIN_URL ?? 'postgresql://postgres:postgres@127.0.0.1:54329/postgres';
const jwtSecret = process.env.JWT_SECRET ?? 'dev-jwt-secret';
const providerPort = 18082;
const fallback = 'Транскрипт звонка отсутствует. Это тестовая заглушка.';

function token(orgId: string): string {
  return sign({ org_id: orgId, role: 'authenticated' }, jwtSecret, {
    algorithm: 'HS256',
    subject: 'p1-smoke',
    expiresIn: '15m'
  });
}

async function api(path: string, authToken: string, init: RequestInit = {}): Promise<Response> {
  return fetch(`${apiUrl}${path}`, {
    ...init,
    headers: {
      authorization: `Bearer ${authToken}`,
      'content-type': 'application/json',
      ...init.headers
    }
  });
}

test('P1 analysis flow: retry, replay, fallback, partial, cancel and tenant isolation', async () => {
  const admin = new Pool({ connectionString: adminUrl, max: 5 });
  const orgA = randomUUID();
  const orgB = randomUUID();
  const campaign = randomUUID();
  const attempts = {
    retry: randomUUID(),
    fallback: randomUUID(),
    partial: randomUUID(),
    cancel: randomUUID(),
    recovery: randomUUID()
  };
  const providerRequests = new Map<string, number>();
  const seenTranscripts: string[] = [];

  const provider = createServer(async (req, res) => {
    if (req.method !== 'POST' || req.url !== '/v1/analyze') {
      res.writeHead(404).end();
      return;
    }

    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(Buffer.from(chunk));
    const body = JSON.parse(Buffer.concat(chunks).toString('utf8')) as { request_id: string; transcript: string };
    seenTranscripts.push(body.transcript);
    providerRequests.set(body.transcript, (providerRequests.get(body.transcript) ?? 0) + 1);

    if (body.transcript === 'retry-case' && providerRequests.get(body.transcript) === 1) {
      res.writeHead(429, { 'retry-after': '0' }).end();
      return;
    }
    if (body.transcript === 'partial-case') {
      startSse(res);
      res.write('event: chunk\ndata: {"field":"summary","delta":"partial text"}\n\n');
      res.end();
      return;
    }
    if (body.transcript === 'cancel-case') {
      startSse(res);
      res.write('event: chunk\ndata: {"field":"summary","delta":"started"}\n\n');
      const timer = setInterval(() => res.write(': keep-alive\n\n'), 200);
      res.on('close', () => clearInterval(timer));
      return;
    }

    startSse(res);
    res.write('event: chunk\ndata: {"field":"summary","delta":"hello"}\n\n');
    res.end('event: done\ndata: {"result":{"summary":"hello","objections":[],"next_step":"call_back","lead_score":80,"confidence":0.8}}\n\n');
  });

  await new Promise<void>((resolveListen, reject) => {
    provider.once('error', reject);
    provider.listen(providerPort, '0.0.0.0', () => resolveListen());
  });

  try {
    await admin.query('INSERT INTO orgs(id, name) VALUES ($1, $2), ($3, $4)', [orgA, 'P1 A', orgB, 'P1 B']);
    await admin.query(`
      INSERT INTO campaigns(id, org_id, name, status)
      VALUES ($1, $2, 'P1', 'active')
    `, [campaign, orgA]);

    let i = 0;
    for (const [kind, attemptId] of Object.entries(attempts)) {
      const contactId = randomUUID();
      const transcript = kind === 'retry' ? 'retry-case'
        : kind === 'fallback' ? '   '
          : kind === 'partial' ? 'partial-case'
            : kind === 'cancel' ? 'cancel-case'
              : 'recovery-case';
      await admin.query(`
        INSERT INTO contacts(id, org_id, campaign_id, phone_e164, timezone)
        VALUES ($1, $2, $3, $4, 'UTC')
      `, [contactId, orgA, campaign, `+1000000010${i++}`]);
      await admin.query(`
        INSERT INTO call_attempts(
          id, org_id, campaign_id, contact_id, provider_call_id, status, started_at, ended_at, transcript
        ) VALUES ($1, $2, $3, $4, $5, 'completed', now() - interval '1 minute', now(), $6)
      `, [attemptId, orgA, campaign, contactId, `p1-${attemptId}`, transcript]);
    }

    const recoveredAnalysisId = randomUUID();
    await admin.query(`
      INSERT INTO analyses(
        id, org_id, call_attempt_id, status, partial_result, provider_started_at, lease_until, lease_token
      ) VALUES (
        $1, $2, $3, 'streaming', '{\"summary\":\"before crash\"}'::jsonb,
        now() - interval '2 minutes', now() - interval '1 minute', $4
      )
    `, [recoveredAnalysisId, orgA, attempts.recovery, randomUUID()]);

    const authA = token(orgA);
    const authB = token(orgB);

    const recovered = await waitForStatus(authA, recoveredAnalysisId, ['partial']);
    assert.equal(recovered.partial_result.summary, 'before crash');
    assert.equal(providerRequests.get('recovery-case'), undefined);

    const createdRetry = await create(authA, attempts.retry);
    const repeatedRetry = await create(authA, attempts.retry);
    assert.equal(repeatedRetry.id, createdRetry.id);
    const retryDone = await waitForStatus(authA, createdRetry.id, ['completed']);
    assert.equal(retryDone.result?.summary, 'hello');
    assert.equal(providerRequests.get('retry-case'), 2);

    const replayAll = await streamText(authA, createdRetry.id);
    const eventIds = [...replayAll.matchAll(/^id: (\d+)$/gm)].map((match) => match[1]!);
    assert.ok(eventIds.length >= 2);
    const replayTail = await streamText(authA, createdRetry.id, eventIds[0]);
    assert.ok(!replayTail.includes(`id: ${eventIds[0]}\n`));
    assert.match(replayTail, /event: done/);

    const foreign = await api(`/api/analyses/${createdRetry.id}`, authB);
    assert.equal(foreign.status, 404);

    const createdFallback = await create(authA, attempts.fallback);
    await waitForStatus(authA, createdFallback.id, ['completed']);
    assert.ok(seenTranscripts.includes(fallback));

    const createdPartial = await create(authA, attempts.partial);
    const partial = await waitForStatus(authA, createdPartial.id, ['partial']);
    assert.equal(partial.partial_result.summary, 'partial text');

    const createdCancel = await create(authA, attempts.cancel);
    await waitForStatus(authA, createdCancel.id, ['streaming']);
    const cancelResponse = await api(`/api/analyses/${createdCancel.id}/cancel`, authA, { method: 'POST' });
    assert.equal(cancelResponse.status, 200);
    await waitForStatus(authA, createdCancel.id, ['cancelled']);
  } finally {
    provider.closeAllConnections?.();
    await new Promise<void>((resolveClose) => provider.close(() => resolveClose()));
    await admin.query('DELETE FROM analyses WHERE org_id IN ($1, $2)', [orgA, orgB]).catch(() => undefined);
    await admin.query('DELETE FROM crm_outbox WHERE org_id IN ($1, $2)', [orgA, orgB]).catch(() => undefined);
    await admin.query('DELETE FROM webhook_events WHERE org_id IN ($1, $2)', [orgA, orgB]).catch(() => undefined);
    await admin.query('DELETE FROM call_attempts WHERE org_id IN ($1, $2)', [orgA, orgB]).catch(() => undefined);
    await admin.query('DELETE FROM contacts WHERE org_id IN ($1, $2)', [orgA, orgB]).catch(() => undefined);
    await admin.query('DELETE FROM campaigns WHERE org_id IN ($1, $2)', [orgA, orgB]).catch(() => undefined);
    await admin.query('DELETE FROM orgs WHERE id IN ($1, $2)', [orgA, orgB]).catch(() => undefined);
    await admin.end();
  }
});

function startSse(res: ServerResponse): void {
  res.writeHead(200, {
    'content-type': 'text/event-stream',
    'cache-control': 'no-cache',
    connection: 'keep-alive'
  });
  res.flushHeaders();
}

async function create(authToken: string, callAttemptId: string): Promise<{ id: string; status: string }> {
  const response = await api('/api/analyses', authToken, {
    method: 'POST',
    body: JSON.stringify({ call_attempt_id: callAttemptId })
  });
  assert.equal(response.status, 200);
  return response.json() as Promise<{ id: string; status: string }>;
}

async function waitForStatus(
  authToken: string,
  analysisId: string,
  statuses: string[]
): Promise<{
  status: string;
  partial_result: Record<string, string>;
  result: { summary: string } | null;
}> {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    const response = await api(`/api/analyses/${analysisId}`, authToken);
    assert.equal(response.status, 200);
    const body = await response.json() as {
      status: string;
      partial_result: Record<string, string>;
      result: { summary: string } | null;
    };
    if (statuses.includes(body.status)) return body;
    await new Promise((resolveWait) => setTimeout(resolveWait, 100));
  }
  throw new Error(`Timed out waiting for ${statuses.join(',')}`);
}

async function streamText(authToken: string, analysisId: string, lastEventId?: string): Promise<string> {
  const response = await fetch(`${apiUrl}/api/analyses/${analysisId}/stream`, {
    headers: {
      authorization: `Bearer ${authToken}`,
      ...(lastEventId ? { 'last-event-id': lastEventId } : {})
    }
  });
  assert.equal(response.status, 200);
  return response.text();
}
