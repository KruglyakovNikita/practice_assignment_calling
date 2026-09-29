import assert from 'node:assert/strict';
import { createHmac, randomUUID } from 'node:crypto';
import test from 'node:test';
import { config as loadEnv } from 'dotenv';
import { sign } from 'jsonwebtoken';
import { Pool } from 'pg';
import { resolve } from 'node:path';

loadEnv({ path: resolve(process.cwd(), '../../.env') });

const apiUrl = process.env.API_URL ?? 'http://127.0.0.1:8080';
const adminUrl = process.env.DATABASE_ADMIN_URL ?? 'postgresql://postgres:postgres@127.0.0.1:54329/postgres';
const appPassword = process.env.APP_DB_PASSWORD ?? 'app-local-only';
const appUrl = process.env.DATABASE_URL ?? `postgresql://auto_calling_app:${appPassword}@127.0.0.1:54329/postgres`;
const jwtSecret = process.env.JWT_SECRET ?? 'dev-jwt-secret';
const webhookSecret = process.env.WEBHOOK_SECRET ?? 'dev-webhook-secret';

function token(orgId: string, secret = jwtSecret): string {
  return sign({ org_id: orgId, role: 'worker' }, secret, {
    algorithm: 'HS256',
    subject: 'p0-smoke',
    expiresIn: '15m'
  });
}

async function signedWebhook(payload: Record<string, unknown>, signatureSecret = webhookSecret): Promise<Response> {
  const body = JSON.stringify(payload);
  const signature = createHmac('sha256', signatureSecret).update(body).digest('hex');
  return fetch(`${apiUrl}/webhooks/calls`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-signature': `sha256=${signature}`
    },
    body
  });
}

test('P0 core invariants', async () => {
  const admin = new Pool({ connectionString: adminUrl, max: 5 });
  const app = new Pool({ connectionString: appUrl, max: 5 });
  const orgA = randomUUID();
  const orgB = randomUUID();
  const campaignA = randomUUID();
  const campaignB = randomUUID();
  const contactA = randomUUID();
  const contactB = randomUUID();

  try {
    const timezoneResult = await admin.query<{ name: string }>(`
      SELECT name
        FROM pg_timezone_names
       WHERE (now() AT TIME ZONE name)::time >= time '09:00'
         AND (now() AT TIME ZONE name)::time < time '20:00'
       ORDER BY name
       LIMIT 1
    `);
    const timezone = timezoneResult.rows[0]?.name;
    assert.ok(timezone, 'expected at least one eligible timezone');

    await admin.query('INSERT INTO orgs(id, name) VALUES ($1, $2), ($3, $4)', [orgA, 'A', orgB, 'B']);
    await admin.query(`
      INSERT INTO campaigns(id, org_id, name, status)
      VALUES ($1, $2, 'A', 'active'), ($3, $4, 'B', 'active')
    `, [campaignA, orgA, campaignB, orgB]);
    await admin.query(`
      INSERT INTO contacts(id, org_id, campaign_id, phone_e164, timezone)
      VALUES ($1, $2, $3, '+10000000001', $5), ($4, $6, $7, '+10000000002', $5)
    `, [contactA, orgA, campaignA, contactB, timezone, orgB, campaignB]);

    const client = await app.connect();
    try {
      await client.query('BEGIN');
      await client.query(`SELECT set_config('app.jwt', $1, true)`, [token(orgA)]);
      const visible = await client.query<{ id: string }>('SELECT id FROM orgs ORDER BY id');
      assert.deepEqual(visible.rows.map((row: { id: string }) => row.id), [orgA]);
      await client.query('ROLLBACK');

      await client.query('BEGIN');
      await client.query(`SELECT set_config('app.jwt', $1, true)`, [token(orgA, 'wrong-secret')]);
      await assert.rejects(() => client.query('SELECT id FROM orgs'), /tenant JWT signature is invalid/);
      await client.query('ROLLBACK');
    } finally {
      client.release();
    }

    const claims = await Promise.all(Array.from({ length: 20 }, () => fetch(`${apiUrl}/rpc/claim_next_contact`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${token(orgA)}`,
        'content-type': 'application/json'
      },
      body: JSON.stringify({ campaign_id: campaignA })
    })));
    assert.ok(claims.every((response) => response.status === 200));

    const claimBodies = await Promise.all(claims.map((response) => response.json() as Promise<{ contact: null | { id: string; attempt_id: string } }>));
    const claimed = claimBodies.filter((body) => body.contact !== null);
    assert.equal(claimed.length, 1);
    assert.equal(claimed[0]?.contact?.id, contactA);
    const attemptId = claimed[0]?.contact?.attempt_id;
    assert.ok(attemptId);

    const attempt = await admin.query<{ provider_call_id: string }>('SELECT provider_call_id FROM call_attempts WHERE id = $1', [attemptId]);
    assert.equal(attempt.rows[0]?.provider_call_id, attemptId);

    const invalidBody = JSON.stringify({ event_id: 'bad', call_id: attemptId, sequence: 1, type: 'call.dialing', occurred_at: new Date().toISOString(), data: {} });
    const invalidSignature = await fetch(`${apiUrl}/webhooks/calls`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-signature': 'sha256='.padEnd(71, '0') },
      body: invalidBody
    });
    assert.equal(invalidSignature.status, 401);

    const unknown = await signedWebhook({
      event_id: `evt_${randomUUID()}`,
      call_id: `unknown_${randomUUID()}`,
      sequence: 1,
      type: 'call.dialing',
      occurred_at: new Date().toISOString(),
      data: {}
    });
    assert.equal(unknown.status, 404);

    const answered = {
      event_id: `evt_${randomUUID()}`,
      call_id: attemptId,
      sequence: 2,
      type: 'call.answered',
      occurred_at: new Date().toISOString(),
      data: { sip_code: 200 }
    };
    assert.equal((await signedWebhook(answered)).status, 200);

    const oldDialing = {
      event_id: `evt_${randomUUID()}`,
      call_id: attemptId,
      sequence: 1,
      type: 'call.dialing',
      occurred_at: new Date(Date.now() - 1000).toISOString(),
      data: {}
    };
    assert.equal((await signedWebhook(oldDialing)).status, 200);

    const completed = {
      event_id: `evt_${randomUUID()}`,
      call_id: attemptId,
      sequence: 3,
      type: 'call.completed',
      occurred_at: new Date().toISOString(),
      data: { duration_sec: 10, do_not_call: true }
    };
    assert.equal((await signedWebhook(completed)).status, 200);
    const duplicate = await signedWebhook(completed);
    assert.equal(duplicate.status, 200);
    assert.equal((await duplicate.json() as { duplicate: boolean }).duplicate, true);

    const newerNonTerminal = {
      event_id: `evt_${randomUUID()}`,
      call_id: attemptId,
      sequence: 4,
      type: 'call.queued',
      occurred_at: new Date().toISOString(),
      data: {}
    };
    assert.equal((await signedWebhook(newerNonTerminal)).status, 200);

    const finalAttempt = await admin.query<{
      status: string;
      last_sequence: string;
      started_at: Date | null;
    }>('SELECT status, last_sequence, started_at FROM call_attempts WHERE id = $1', [attemptId]);
    assert.equal(finalAttempt.rows[0]?.status, 'completed');
    assert.equal(finalAttempt.rows[0]?.last_sequence, '4');
    assert.ok(finalAttempt.rows[0]?.started_at);

    const contact = await admin.query<{ attempts_count: number; do_not_call: boolean; last_attempt_at: Date | null }>(
      'SELECT attempts_count, do_not_call, last_attempt_at FROM contacts WHERE id = $1',
      [contactA]
    );
    assert.equal(contact.rows[0]?.attempts_count, 1);
    assert.equal(contact.rows[0]?.do_not_call, true);
    assert.ok(contact.rows[0]?.last_attempt_at);

    const events = await admin.query<{ count: string }>('SELECT count(*)::text AS count FROM webhook_events WHERE provider_call_id = $1', [attemptId]);
    assert.equal(events.rows[0]?.count, '4');
    const outbox = await admin.query<{ count: string }>('SELECT count(*)::text AS count FROM crm_outbox WHERE attempt_id = $1', [attemptId]);
    assert.equal(outbox.rows[0]?.count, '1');
  } finally {
    await admin.query('DELETE FROM crm_outbox WHERE org_id IN ($1, $2)', [orgA, orgB]).catch(() => undefined);
    await admin.query('DELETE FROM webhook_events WHERE org_id IN ($1, $2)', [orgA, orgB]).catch(() => undefined);
    await admin.query('DELETE FROM call_attempts WHERE org_id IN ($1, $2)', [orgA, orgB]).catch(() => undefined);
    await admin.query('DELETE FROM contacts WHERE org_id IN ($1, $2)', [orgA, orgB]).catch(() => undefined);
    await admin.query('DELETE FROM campaigns WHERE org_id IN ($1, $2)', [orgA, orgB]).catch(() => undefined);
    await admin.query('DELETE FROM orgs WHERE id IN ($1, $2)', [orgA, orgB]).catch(() => undefined);
    await Promise.all([admin.end(), app.end()]);
  }
});
