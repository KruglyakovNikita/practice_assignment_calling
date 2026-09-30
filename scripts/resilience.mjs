// Restart under traffic: API is stopped mid-flight, started again 5 s later, then the DB is checked
// for lost or double-applied work. Serves CRM/provider stubs on host ports 18081/18082, so .env must
// point CRM_URL/PROVIDER_URL at host.docker.internal (as .env.example does).
//   node scripts/resilience.mjs --mode=stop   # docker compose stop (SIGTERM, graceful)
//   node scripts/resilience.mjs --mode=kill   # SIGKILL, crash
import { execSync } from 'node:child_process';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { randomUUID } from 'node:crypto';
import { arg, loadEnv, signBody, signJwt } from './load/lib.mjs';

loadEnv();
const require = createRequire(new URL('../app/backend/package.json', import.meta.url));
const { Pool } = require('pg');

const mode = arg('mode', 'stop');
const calls = Number(arg('calls', '120'));
const api = process.env.API_URL ?? 'http://localhost:8080';
const db = new Pool({ connectionString: process.env.DATABASE_ADMIN_URL ?? 'postgresql://postgres:postgres@localhost:54329/postgres' });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const q = async (sql, params = []) => (await db.query(sql, params)).rows;
let failed = 0;
const check = (name, ok, detail) => {
  if (!ok) failed += 1;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail === undefined ? '' : `  ${JSON.stringify(detail)}`}`);
};

// ---------- stubs ----------
const crmOk = new Map();
let crmHits = 0;
const crm = createServer(async (req, res) => {
  let body = '';
  for await (const chunk of req) body += chunk;
  crmHits += 1;
  await sleep(300);
  if (Math.random() < 0.3) { res.writeHead(503).end(); return; }
  const id = JSON.parse(body).attempt_id;
  crmOk.set(id, (crmOk.get(id) ?? 0) + 1);
  res.writeHead(200).end();
});
const providerCalls = new Map();
const provider = createServer(async (req, res) => {
  let raw = '';
  for await (const chunk of req) raw += chunk;
  const { request_id: id, transcript } = JSON.parse(raw);
  providerCalls.set(id, (providerCalls.get(id) ?? 0) + 1);
  res.writeHead(200, { 'content-type': 'text/event-stream' });
  const steps = transcript.includes('[long]') ? 40 : 8;
  for (let i = 0; i < steps; i += 1) {
    if (res.destroyed) return;
    res.write(`event: chunk\ndata: ${JSON.stringify({ field: 'summary', delta: `w${i} ` })}\n\n`);
    await sleep(350);
  }
  res.end(`event: done\ndata: ${JSON.stringify({ result: { summary: 'ok', objections: [], next_step: 'call_back', lead_score: 50, confidence: 0.5 } })}\n\n`);
});
await new Promise((r) => crm.listen(18081, '0.0.0.0', r));
await new Promise((r) => provider.listen(18082, '0.0.0.0', r));

// ---------- data ----------
const [{ org }] = await q(`INSERT INTO orgs(name) VALUES ('resilience') RETURNING id AS org`);
const [{ campaign }] = await q(`INSERT INTO campaigns(org_id, name, status) VALUES ($1, 'r', 'active') RETURNING id AS campaign`, [org]);
const attempts = await q(`
  WITH c AS (INSERT INTO contacts(org_id, campaign_id, phone_e164, timezone)
             SELECT $1, $2, '+1777' || g, 'UTC' FROM generate_series(1, $3) g RETURNING id)
  INSERT INTO call_attempts(org_id, campaign_id, contact_id, provider_call_id, status)
  SELECT $1, $2, id, 'call_' || gen_random_uuid(), 'queued' FROM c RETURNING id, provider_call_id, contact_id`, [org, campaign, calls]);
const analysable = await q(`
  WITH c AS (INSERT INTO contacts(org_id, campaign_id, phone_e164, timezone)
             SELECT $1, $2, '+1778' || g, 'UTC' FROM generate_series(1, 12) g RETURNING id)
  INSERT INTO call_attempts(org_id, campaign_id, contact_id, provider_call_id, status, ended_at, outcome, transcript)
  SELECT $1, $2, id, 'an_' || gen_random_uuid(), 'completed', now(), '{}',
         CASE WHEN row_number() OVER () <= 3 THEN 'long call [long]' ELSE 'regular call' END
    FROM c RETURNING id`, [org, campaign]);
const token = signJwt({ sub: 'resilience', org_id: org, role: 'worker' }, process.env.JWT_SECRET);

// ---------- provider: webhooks, at-least-once until 2xx ----------
const webhookStats = { sent: 0, ok: 0, server5xx: 0, refused: 0, other: {} };
async function deliver(event) {
  const body = JSON.stringify(event);
  for (;;) {
    webhookStats.sent += 1;
    try {
      const res = await fetch(`${api}/webhooks/calls`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-signature': signBody(body, process.env.WEBHOOK_SECRET) },
        body,
        signal: AbortSignal.timeout(2000)
      });
      await res.arrayBuffer();
      if (res.ok) { webhookStats.ok += 1; return; }
      if (res.status >= 500) webhookStats.server5xx += 1;
      else webhookStats.other[res.status] = (webhookStats.other[res.status] ?? 0) + 1;
    } catch {
      webhookStats.refused += 1;
    }
    await sleep(500);
  }
}
const types = ['call.queued', 'call.dialing', 'call.answered'];
const terminalType = (i) => ['call.completed', 'call.failed', 'call.no_answer'][i % 3];
const webhookRun = (async () => {
  const pending = [];
  for (let step = 0; step < 4; step += 1) {
    for (const [i, a] of attempts.entries()) {
      const type = step < 3 ? types[step] : terminalType(i);
      pending.push(deliver({
        event_id: `evt_${a.provider_call_id}_${step}`, call_id: a.provider_call_id, sequence: step + 1, type,
        occurred_at: new Date().toISOString(), data: step === 3 ? { sip_code: 200, n: i } : {}
      }));
      if (Math.random() < 0.1) pending.push(deliver({ // duplicate delivery
        event_id: `evt_${a.provider_call_id}_${step}`, call_id: a.provider_call_id, sequence: step + 1, type,
        occurred_at: new Date().toISOString(), data: step === 3 ? { sip_code: 200, n: i } : {}
      }));
      await sleep(25); // ~40 events/s
    }
  }
  await Promise.all(pending);
})();

// ---------- analyses + SSE clients that resume with Last-Event-ID ----------
async function withRetry(fn) {
  for (;;) {
    try { return await fn(); } catch { await sleep(500); }
  }
}
const sseSeen = new Map();
async function follow(analysisId) {
  const seen = [];
  sseSeen.set(analysisId, seen);
  for (;;) {
    try {
      const res = await fetch(`${api}/api/analyses/${analysisId}/stream`, {
        headers: { authorization: `Bearer ${token}`, ...(seen.length ? { 'last-event-id': seen.at(-1).id } : {}) }
      });
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        let idx;
        while ((idx = buffer.indexOf('\n\n')) >= 0) {
          const block = buffer.slice(0, idx);
          buffer = buffer.slice(idx + 2);
          const id = block.match(/^id: ?(.*)$/m)?.[1];
          const event = block.match(/^event: ?(.*)$/m)?.[1];
          if (id) seen.push({ id, event });
          if (event === 'done' || event === 'error') return;
        }
      }
    } catch {
      // connection dropped / API down: reconnect below
    }
    await sleep(500);
  }
}
const analysisIds = [];
const analysisRun = (async () => {
  await sleep(3000);
  for (const a of analysable) {
    const created = await withRetry(async () => {
      const res = await fetch(`${api}/api/analyses`, {
        method: 'POST',
        headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
        body: JSON.stringify({ call_attempt_id: a.id })
      });
      if (!res.ok) throw new Error(String(res.status));
      return res.json();
    });
    analysisIds.push(created.id);
    void follow(created.id);
    await sleep(400);
  }
})();

// ---------- the restart ----------
await sleep(6000);
const t0 = Date.now();
if (mode === 'kill') execSync('docker compose kill -s SIGKILL api', { stdio: 'ignore' });
else execSync('docker compose stop api', { stdio: 'ignore' });
const stopMs = Date.now() - t0;
console.log(`# API ${mode === 'kill' ? 'killed' : 'stopped gracefully'} in ${stopMs} ms; restarting in 5 s`);
await sleep(5000);
execSync('docker compose start api', { stdio: 'ignore' });

await Promise.all([webhookRun, analysisRun]);
// Kill: 30 s lease + exponential CRM backoff (1, 2, 4 … s) under 30% rejects can take minutes.
const deadline = Date.now() + (mode === 'kill' ? 300_000 : 180_000);
const settled = async () => {
  const [o] = await q(`SELECT count(*) FILTER (WHERE status <> 'delivered')::int AS open FROM crm_outbox WHERE org_id = $1`, [org]);
  const [a] = await q(`SELECT count(*) FILTER (WHERE status IN ('queued', 'streaming'))::int AS open FROM analyses WHERE org_id = $1`, [org]);
  return o.open === 0 && a.open === 0 && [...sseSeen.values()].every((s) => ['done', 'error'].includes(s.at(-1)?.event));
};
while (Date.now() < deadline && !(await settled())) await sleep(1000);

// ---------- verdict ----------
console.log(`\n# verdict (${mode})`);
const rows = await q(`
  SELECT a.id, a.status, (SELECT count(*)::int FROM webhook_events w WHERE w.provider_call_id = a.provider_call_id) AS events,
         c.attempts_count, (SELECT count(*)::int FROM crm_outbox o WHERE o.attempt_id = a.id) AS outbox
    FROM call_attempts a JOIN contacts c ON c.id = a.contact_id
   WHERE a.id = ANY($1::uuid[])`, [attempts.map((a) => a.id)]);
check('every accepted provider event stored exactly once (4 per call)', rows.every((r) => r.events === 4), rows.filter((r) => r.events !== 4).length);
check('every call reached its terminal status', rows.every((r) => ['completed', 'failed', 'no_answer'].includes(r.status)));
check('terminal trigger applied exactly once (attempts_count = 1)', rows.every((r) => r.attempts_count === 1), rows.filter((r) => r.attempts_count !== 1).length);
check('exactly one CRM outbox row per call', rows.every((r) => r.outbox === 1));
check('no 5xx from the API during stop/start (only refused while down)', webhookStats.server5xx === 0, webhookStats);
const [outbox] = await q(`SELECT count(*) FILTER (WHERE status = 'delivered')::int AS delivered, count(*) FILTER (WHERE status = 'dead')::int AS dead,
  count(*) FILTER (WHERE status NOT IN ('delivered', 'dead'))::int AS open FROM crm_outbox WHERE org_id = $1`, [org]);
check('CRM: every notification delivered, none dead, despite 30% rejects', outbox.delivered === calls && outbox.dead === 0, outbox);
const crmDup = [...crmOk.values()].filter((n) => n > 1).length;
check(`CRM: duplicate successful deliveries = ${crmDup}${mode === 'kill' ? ' (at-least-once after crash is allowed)' : ''}`, mode === 'kill' || crmDup === 0, { crmHits, uniqueDelivered: crmOk.size });

const analyses = await q(`SELECT id, status, error_code FROM analyses WHERE id = ANY($1::uuid[])`, [analysisIds]);
const byStatus = analyses.reduce((acc, a) => ({ ...acc, [`${a.status}${a.error_code ? `:${a.error_code}` : ''}`]: (acc[`${a.status}${a.error_code ? `:${a.error_code}` : ''}`] ?? 0) + 1 }), {});
check('every analysis finished (no stuck queued/streaming)', analyses.length === analysable.length && analyses.every((a) => !['queued', 'streaming'].includes(a.status)), byStatus);
check('provider never called twice for one analysis (no silent regeneration)', analysisIds.every((id) => (providerCalls.get(id) ?? 0) <= 1),
  analysisIds.map((id) => providerCalls.get(id) ?? 0));
let sseOk = true;
for (const id of analysisIds) {
  const journal = (await q(`SELECT e.id::text AS id FROM analysis_events e WHERE e.analysis_id = $1 ORDER BY e.id`, [id])).map((r) => r.id);
  const seen = (sseSeen.get(id) ?? []).map((e) => e.id);
  if (JSON.stringify(journal) !== JSON.stringify(seen)) { sseOk = false; console.log('  sse mismatch', id, { journal: journal.length, seen: seen.length }); }
}
check('SSE clients got the full journal across the restart: no gaps, no repeats', sseOk);

crm.close();
provider.close();
await db.end();
console.log(`\n${failed === 0 ? 'ALL PASS' : `${failed} FAILED`}`);
process.exit(failed === 0 ? 0 : 1);
