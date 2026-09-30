// Open-loop webhook load (fixed arrival rate, like a provider), with a slow and failing CRM.
// Serves the CRM stub itself on :18081, so .env CRM_URL must point at host.docker.internal:18081.
//   node scripts/load/webhooks.mjs --rps=50 --seconds=60
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { randomUUID } from 'node:crypto';
import { arg, loadEnv, signBody, stats } from './lib.mjs';

loadEnv();
const require = createRequire(new URL('../../app/backend/package.json', import.meta.url));
const { Pool } = require('pg');

const api = arg('api', process.env.API_URL ?? 'http://localhost:8080');
const rps = Number(arg('rps', '50'));
const seconds = Number(arg('seconds', '60'));
const crmDelayMs = Number(arg('crm-delay-ms', '1500'));
const crmFailRate = Number(arg('crm-fail-rate', '0.5'));
const db = new Pool({ connectionString: process.env.DATABASE_ADMIN_URL ?? 'postgresql://postgres:postgres@localhost:54329/postgres' });

let crmHits = 0;
let crmOk = 0;
const crm = createServer(async (req, res) => {
  for await (const _ of req) { /* drain */ }
  crmHits += 1;
  await new Promise((r) => setTimeout(r, crmDelayMs));
  if (Math.random() < crmFailRate) { res.writeHead(503).end(); return; }
  crmOk += 1;
  res.writeHead(200).end();
});
await new Promise((r) => crm.listen(18081, '0.0.0.0', r));

// Each call produces 4 events (queued, dialing, answered, terminal) + ~10% duplicate deliveries.
const total = rps * seconds;
const calls = Math.ceil(total / 4.4);
const [{ org }] = (await db.query(`INSERT INTO orgs(name) VALUES ('load-webhooks') RETURNING id AS org`)).rows;
const [{ campaign }] = (await db.query(`INSERT INTO campaigns(org_id, name, status) VALUES ($1, 'load', 'active') RETURNING id AS campaign`, [org])).rows;
const { rows } = await db.query(`
  WITH c AS (
    INSERT INTO contacts(org_id, campaign_id, phone_e164, timezone)
    SELECT $1, $2, '+1666' || g, 'UTC' FROM generate_series(1, $3) g RETURNING id
  )
  INSERT INTO call_attempts(org_id, campaign_id, contact_id, provider_call_id, status)
  SELECT $1, $2, c.id, 'call_' || gen_random_uuid(), 'queued' FROM c
  RETURNING provider_call_id`, [org, campaign, calls]);

const terminal = ['call.completed', 'call.failed', 'call.no_answer'];
const queue = [];
const perCall = rows.map((row) => ['call.queued', 'call.dialing', 'call.answered', terminal[Math.floor(Math.random() * 3)]]
  .map((type, i) => ({ event_id: `evt_${randomUUID()}`, call_id: row.provider_call_id, sequence: i + 1, type, occurred_at: new Date().toISOString(), data: { sip_code: 200, duration_sec: i } })));
// interleave calls so events of one call are spread out, like real traffic
for (let i = 0; i < 4; i += 1) for (const events of perCall) {
  queue.push(events[i]);
  if (Math.random() < 0.1) queue.push(events[i]);
}

const latencies = [];
const statuses = {};
let inFlight = 0;
const started = performance.now();
const sends = [];
for (let n = 0; n < Math.min(total, queue.length); n += 1) {
  const due = started + (n * 1000) / rps;
  const wait = due - performance.now();
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  const body = JSON.stringify(queue[n]);
  inFlight += 1;
  const t0 = performance.now();
  sends.push(fetch(`${api}/webhooks/calls`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-signature': signBody(body, process.env.WEBHOOK_SECRET) },
    body,
    signal: AbortSignal.timeout(2000)
  }).then(async (res) => {
    await res.arrayBuffer();
    latencies.push(performance.now() - t0);
    statuses[res.status] = (statuses[res.status] ?? 0) + 1;
  }, (error) => {
    latencies.push(performance.now() - t0);
    statuses[error.name] = (statuses[error.name] ?? 0) + 1;
  }).finally(() => { inFlight -= 1; }));
}
await Promise.all(sends);
const elapsed = (performance.now() - started) / 1000;

const drainSeconds = Number(arg('drain-seconds', '0'));
const outboxSql = `SELECT count(*) FILTER (WHERE status = 'delivered')::int AS delivered,
  count(*) FILTER (WHERE status IN ('pending', 'delivering'))::int AS pending, count(*) FILTER (WHERE status = 'dead')::int AS dead
  FROM crm_outbox WHERE org_id = $1`;
const drainStarted = Date.now();
while (Date.now() - drainStarted < drainSeconds * 1000 && (await db.query(outboxSql, [org])).rows[0].pending > 0) {
  await new Promise((r) => setTimeout(r, 1000));
}
const [outbox] = (await db.query(`SELECT count(*) FILTER (WHERE status = 'delivered')::int AS delivered,
  count(*) FILTER (WHERE status IN ('pending', 'delivering'))::int AS pending, count(*) FILTER (WHERE status = 'dead')::int AS dead
  FROM crm_outbox WHERE org_id = $1`, [org])).rows;
console.log(JSON.stringify({
  scenario: 'webhooks',
  target_rps: rps,
  achieved_rps: Math.round((latencies.length / elapsed) * 10) / 10,
  sent: latencies.length,
  statuses,
  over_2s: latencies.filter((ms) => ms >= 2000).length,
  latency: stats(latencies),
  crm: { delay_ms: crmDelayMs, fail_rate: crmFailRate, hits: crmHits, ok: crmOk, outbox: outbox, drained_after_s: drainSeconds ? Math.round((Date.now() - drainStarted) / 1000) : null }
}, null, 2));
crm.close();
await db.end();
