// Black-box acceptance check against the running compose stack, rule by rule from the task.
// Needs: `docker compose up -d`, .env with CRM_URL/PROVIDER_URL pointing at
// host.docker.internal:18081 / :18082 (this script serves both), free host ports 18081/18082.
//   node scripts/acceptance.mjs
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { randomUUID } from 'node:crypto';
import { loadEnv, signBody, signJwt } from './load/lib.mjs';

loadEnv();
const require = createRequire(new URL('../app/backend/package.json', import.meta.url));
const { Pool } = require('pg');

const api = process.env.API_URL ?? 'http://localhost:8080';
const db = new Pool({ connectionString: process.env.DATABASE_ADMIN_URL ?? 'postgresql://postgres:postgres@localhost:54329/postgres' });
const JWT = process.env.JWT_SECRET;
const WEBHOOK = process.env.WEBHOOK_SECRET;
const FALLBACK = 'Транскрипт звонка отсутствует. Это тестовая заглушка.';

let failed = 0;
function check(name, ok, detail = '') {
  if (!ok) failed += 1;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${!ok && detail ? `  -> ${typeof detail === 'string' ? detail : JSON.stringify(detail)}` : ''}`);
}
const canon = (v) => JSON.stringify(v, (_, x) => (x && typeof x === 'object' && !Array.isArray(x) ? Object.fromEntries(Object.entries(x).sort()) : x));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function until(fn, ms = 10000) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    const value = await fn();
    if (value) return value;
    await sleep(100);
  }
  return fn();
}
const q = async (sql, params = []) => (await db.query(sql, params)).rows;
const tok = (org, role = 'worker', secret = JWT) => signJwt({ sub: 'acceptance', org_id: org, role }, secret);

// ---------- mocks ----------
const crmRequests = [];
let crmCalls = 0;
// Per-attempt scripted CRM behaviour: 'ok' | '500' | '400' | 'drop' | 'hang'; otherwise slow + every other 503.
const crmScript = new Map();
const crmTrace = new Map();
const crm = createServer(async (req, res) => {
  let body = '';
  for await (const chunk of req) body += chunk;
  const attemptId = JSON.parse(body).attempt_id;
  const plan = crmScript.get(attemptId);
  if (plan?.length) {
    const step = plan.shift();
    crmTrace.set(attemptId, [...(crmTrace.get(attemptId) ?? []), { step, key: req.headers['idempotency-key'] }]);
    if (step === 'drop') { res.socket.destroy(); return; }
    if (step === 'hang') { await sleep(12_000); res.writeHead(200).end(); return; }
    res.writeHead(step === 'ok' ? 200 : Number(step)).end();
    return;
  }
  crmCalls += 1;
  await sleep(1500);
  if (crmCalls % 2 === 1) { res.writeHead(503).end(); return; }
  crmRequests.push({ body: JSON.parse(body), correlation: req.headers['x-correlation-id'] });
  res.writeHead(200).end('{}');
});

const providerCalls = new Map();
const provider = createServer(async (req, res) => {
  let raw = '';
  for await (const chunk of req) raw += chunk;
  const { request_id: requestId, transcript } = JSON.parse(raw);
  const n = (providerCalls.get(requestId)?.n ?? 0) + 1;
  providerCalls.set(requestId, { n, transcript });
  const sse = () => res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' });
  const chunk = (field, delta) => res.write(`event: chunk\ndata: ${JSON.stringify({ field, delta })}\n\n`);
  const good = { summary: 'Клиент заинтересован', objections: ['дорого'], next_step: 'send_proposal', lead_score: 72, confidence: 0.8 };

  if (transcript.includes('[500]')) { res.writeHead(500).end(); return; }
  if (transcript.includes('[json]')) { res.writeHead(200, { 'content-type': 'application/json' }).end('{}'); return; }
  if (transcript.includes('[429x]')) { res.writeHead(429, { 'retry-after': '0' }).end(); return; }
  if (transcript.includes('[badretry]')) { res.writeHead(429, { 'retry-after': 'soon' }).end(); return; }
  if (transcript.includes('[429]') && n === 1) { res.writeHead(429, { 'retry-after': '1' }).end(); return; }
  if (transcript.includes('[break-empty]')) { sse(); res.flushHeaders(); setTimeout(() => res.socket.destroy(), 100); return; }
  sse();
  chunk('summary', 'Клиент ');
  await sleep(300);
  if (transcript.includes('[break]')) { res.socket.destroy(); return; }
  if (transcript.includes('[badchunk]')) { res.end('event: chunk\ndata: {not json\n\n'); return; }
  chunk('summary', 'заинтересован');
  if (transcript.includes('[slow]')) { const t = setInterval(() => chunk('summary', '.'), 300); res.on('close', () => clearInterval(t)); return; }
  await sleep(300);
  chunk('next_step', 'send_proposal');
  const result = transcript.includes('[invalid]') ? { ...good, lead_score: 150 } : good;
  res.end(`event: done\ndata: ${JSON.stringify({ result })}\n\n`);
});

await new Promise((r) => crm.listen(18081, '0.0.0.0', r));
await new Promise((r) => provider.listen(18082, '0.0.0.0', r));

// ---------- helpers ----------
async function claim(token, campaignId) {
  const res = await fetch(`${api}/rpc/claim_next_contact`, {
    method: 'POST',
    headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), 'content-type': 'application/json' },
    body: JSON.stringify({ campaign_id: campaignId })
  });
  return { status: res.status, body: await res.json().catch(() => null) };
}
async function webhook(event, { secret = WEBHOOK, correlation } = {}) {
  const body = JSON.stringify(event);
  const started = performance.now();
  const res = await fetch(`${api}/webhooks/calls`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-signature': signBody(body, secret), ...(correlation ? { 'x-correlation-id': correlation } : {}) },
    body
  });
  return { status: res.status, ms: performance.now() - started };
}
const ev = (callId, sequence, type, data = {}, occurredAt = new Date()) => ({
  event_id: `evt_${randomUUID()}`, call_id: callId, sequence, type, occurred_at: occurredAt.toISOString(), data
});
async function call(method, path, token, body, headers = {}) {
  const res = await fetch(`${api}${path}`, {
    method,
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json', ...headers },
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  return { status: res.status, body: await res.json().catch(() => null) };
}
async function readSse(path, token, lastEventId, stopAfter = Infinity) {
  const res = await fetch(`${api}${path}`, { headers: { authorization: `Bearer ${token}`, ...(lastEventId ? { 'last-event-id': lastEventId } : {}) } });
  const events = [];
  if (!res.ok) return { status: res.status, events };
  const decoder = new TextDecoder();
  let buffer = '';
  const reader = res.body.getReader();
  while (events.length < stopAfter) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let idx;
    while ((idx = buffer.indexOf('\n\n')) >= 0) {
      const block = buffer.slice(0, idx);
      buffer = buffer.slice(idx + 2);
      const e = { id: null, event: 'message', data: '' };
      for (const line of block.split('\n')) {
        if (line.startsWith('id:')) e.id = line.slice(3).trim();
        else if (line.startsWith('event:')) e.event = line.slice(6).trim();
        else if (line.startsWith('data:')) e.data += line.slice(5).trim();
      }
      if (e.data) events.push({ ...e, data: JSON.parse(e.data) });
    }
  }
  await reader.cancel().catch(() => undefined);
  return { status: res.status, contentType: res.headers.get('content-type'), events };
}

// ---------- seed ----------
const [{ inzone }] = await q(`SELECT name AS inzone FROM app_private.timezones WHERE (now() AT TIME ZONE name)::time BETWEEN '10:00' AND '19:00' ORDER BY name LIMIT 1`);
const [{ outzone }] = await q(`SELECT name AS outzone FROM app_private.timezones WHERE (now() AT TIME ZONE name)::time NOT BETWEEN '08:00' AND '21:00' ORDER BY name LIMIT 1`);
const orgA = randomUUID();
const orgB = randomUUID();
await q(`INSERT INTO orgs(id, name) VALUES ($1, 'acc-A'), ($2, 'acc-B')`, [orgA, orgB]);
async function campaign(org, status = 'active') {
  const [{ id }] = await q(`INSERT INTO campaigns(org_id, name, status) VALUES ($1, 'acc', $2) RETURNING id`, [org, status]);
  return id;
}
async function contact(org, campaignId, fields = {}) {
  const f = { timezone: inzone, attempts_count: 0, last_attempt_at: null, do_not_call: false, ...fields };
  const [{ id }] = await q(
    `INSERT INTO contacts(org_id, campaign_id, phone_e164, timezone, attempts_count, last_attempt_at, do_not_call)
     VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
    [org, campaignId, `+1555${Math.floor(Math.random() * 1e7)}`, f.timezone, f.attempts_count, f.last_attempt_at, f.do_not_call]
  );
  return id;
}
const tA = tok(orgA);
const tB = tok(orgB);

console.log(`\n# 5. claim_next_contact  (in-window zone ${inzone}, out-of-window ${outzone})`);
{
  const c = await campaign(orgA);
  const contactId = await contact(orgA, c);
  const r = await claim(tA, c);
  check('eligible contact is issued: 200 {contact:{id,phone_e164,attempt_id}}',
    r.status === 200 && r.body?.contact?.id === contactId && r.body.contact.phone_e164 && r.body.contact.attempt_id
      && Object.keys(r.body.contact).sort().join() === 'attempt_id,id,phone_e164', r);
  const [attempt] = await q('SELECT * FROM call_attempts WHERE id = $1', [r.body?.contact?.attempt_id]);
  check('call_attempts row created: status=queued, org/campaign/contact filled',
    attempt?.status === 'queued' && attempt.contact_id === contactId && attempt.org_id === orgA && attempt.campaign_id === c, attempt);
  const again = await claim(tA, c);
  check('contact not re-issued while attempt non-terminal -> {contact:null}', again.status === 200 && again.body?.contact === null, again);
  await q(`UPDATE call_attempts SET status='completed', ended_at = now() - interval '5 hours' WHERE id = $1`, [attempt.id]);
  const after = await claim(tA, c);
  check('after terminal status + 4h cooldown the contact is issuable again', after.body?.contact?.id === contactId, after);

  for (const status of ['paused', 'draft']) {
    const cc = await campaign(orgA, status);
    await contact(orgA, cc);
    const res = await claim(tA, cc);
    check(`rule 1: campaign '${status}' -> null`, res.status === 200 && res.body?.contact === null, res);
  }
  const rules = [
    ['rule 2: do_not_call=true -> null', { do_not_call: true }, false],
    ['rule 3: attempts_count=3 -> null', { attempts_count: 3 }, false],
    ['rule 3: attempts_count=2 -> issued', { attempts_count: 2 }, true],
    ['rule 4: local time outside [09:00,20:00) -> null', { timezone: outzone }, false],
    ['rule 5: last_attempt_at 3h59m ago -> null', { last_attempt_at: new Date(Date.now() - (4 * 3600 - 60) * 1000) }, false],
    ['rule 5: last_attempt_at 4h01m ago -> issued', { last_attempt_at: new Date(Date.now() - (4 * 3600 + 60) * 1000) }, true]
  ];
  for (const [name, fields, expected] of rules) {
    const cc = await campaign(orgA);
    await contact(orgA, cc, fields);
    const res = await claim(tA, cc);
    check(name, res.status === 200 && (res.body?.contact !== null) === expected, res);
  }
  const [edge] = await q(`SELECT
      (SELECT name FROM app_private.timezones WHERE (now() AT TIME ZONE name)::time >= '20:00' ORDER BY (now() AT TIME ZONE name)::time LIMIT 1) AS at20,
      (SELECT name FROM app_private.timezones WHERE (now() AT TIME ZONE name)::time < '09:00' ORDER BY (now() AT TIME ZONE name)::time DESC LIMIT 1) AS before9`);
  for (const [label, zone] of [['>=20:00', edge.at20], ['<09:00', edge.before9]]) {
    if (!zone) continue;
    const cc = await campaign(orgA);
    await contact(orgA, cc, { timezone: zone });
    const res = await claim(tA, cc);
    check(`rule 4 edge: local ${label} (${zone}) -> null`, res.body?.contact === null, res);
  }

  const cc = await campaign(orgA);
  for (let i = 0; i < 5; i += 1) await contact(orgA, cc);
  const burst = await Promise.all(Array.from({ length: 30 }, () => claim(tA, cc)));
  const ids = burst.filter((x) => x.body?.contact).map((x) => x.body.contact.id);
  check('30 parallel claims on 5 contacts: all 200, exactly 5 distinct issued',
    burst.every((x) => x.status === 200) && ids.length === 5 && new Set(ids).size === 5,
    { statuses: burst.map((x) => x.status), issued: ids.length });

  const authCampaign = await campaign(orgA);
  await contact(orgA, authCampaign);
  check('no Authorization -> 401', (await claim(null, authCampaign)).status === 401);
  check('JWT signed with another secret -> 401', (await claim(tok(orgA, 'worker', 'wrong'), authCampaign)).status === 401);
  check('JWT role outside worker|authenticated -> 401', (await claim(tok(orgA, 'admin'), authCampaign)).status === 401);
  const foreign = await claim(tB, authCampaign);
  const [{ n: foreignAttempts }] = await q('SELECT count(*)::int AS n FROM call_attempts WHERE campaign_id = $1', [authCampaign]);
  check('org B cannot claim from org A campaign (null, nothing created)', foreign.body?.contact === null && foreignAttempts === 0, foreign);
  check('role=authenticated uses the same endpoint', (await claim(tok(orgA, 'authenticated'), authCampaign)).body?.contact !== null);
  const rfcless = await claim(tA, '11111111-1111-1111-1111-111111111111');
  check('non-RFC UUID accepted as campaign_id (200 null, not 400)', rfcless.status === 200 && rfcless.body?.contact === null, rfcless);
}

console.log('\n# 5. tenant isolation via the web-app DB role');
{
  const appDb = new Pool({ connectionString: `postgresql://auto_calling_app:${process.env.APP_DB_PASSWORD ?? 'app-local-only'}@localhost:54329/postgres`, max: 1 });
  const client = await appDb.connect();
  try {
    const noJwt = await client.query('SELECT count(*) FROM contacts').then(() => 'allowed', (e) => e.message);
    check('app role without JWT context cannot read contacts', noJwt !== 'allowed', noJwt);
    await client.query('BEGIN');
    await client.query(`SELECT set_config('app.jwt', $1, true)`, [tA]);
    const orgs = (await client.query('SELECT DISTINCT org_id FROM contacts')).rows.map((r) => r.org_id);
    check('app role with org A JWT sees only org A contacts', orgs.length === 1 && orgs[0] === orgA, orgs);
    const forged = await client.query(`SELECT set_config('app.jwt', $1, true)`, [tok(orgB, 'worker', 'forged')])
      .then(() => client.query('SELECT count(*) FROM contacts')).then(() => 'allowed', (e) => e.message);
    check('forged JWT (wrong secret) rejected inside PostgreSQL', forged !== 'allowed', forged);
    await client.query('ROLLBACK').catch(() => undefined);
  } finally {
    client.release();
    await appDb.end();
  }
}

console.log('\n# 6. webhooks');
let terminalAttempt;
{
  const c = await campaign(orgA);
  const contactId = await contact(orgA, c);
  const { body } = await claim(tA, c);
  const callId = body.contact.attempt_id;
  terminalAttempt = callId;
  const [{ provider_call_id: pcid }] = await q('SELECT provider_call_id FROM call_attempts WHERE id=$1', [callId]);
  check('provider_call_id assigned at claim (= attempt_id)', pcid === callId, pcid);

  const bad = ev(callId, 1, 'call.dialing');
  const badSig = await webhook(bad, { secret: 'wrong' });
  const [{ n: stored }] = await q('SELECT count(*)::int AS n FROM webhook_events WHERE provider_event_id=$1', [bad.event_id]);
  check('invalid X-Signature -> 401, body not stored', badSig.status === 401 && stored === 0, badSig);
  const noSig = await fetch(`${api}/webhooks/calls`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(bad) });
  check('missing X-Signature -> 401', noSig.status === 401);

  const status = async () => (await q('SELECT * FROM call_attempts WHERE id=$1', [callId]))[0];
  const answeredAt = new Date(Date.now() - 60_000);
  const endedAt = new Date(Date.now() - 1_000);
  const correlation = `acc-${randomUUID()}`;
  const lat = [];
  for (const [seq, type, expect] of [[1, 'call.queued', 'queued'], [2, 'call.dialing', 'dialing'], [3, 'call.answered', 'in_progress']]) {
    const r = await webhook(ev(callId, seq, type, {}, type === 'call.answered' ? answeredAt : new Date()));
    lat.push(r.ms);
    const s = await status();
    check(`${type} -> 2xx, status=${expect}`, r.status >= 200 && r.status < 300 && s.status === expect, { http: r.status, status: s.status });
  }
  check('call.answered fills started_at from occurred_at', (await status()).started_at?.getTime() === answeredAt.getTime());

  const completed = ev(callId, 4, 'call.completed', { sip_code: 200, duration_sec: 42, do_not_call: true }, endedAt);
  const r1 = await webhook(completed, { correlation });
  const r2 = await webhook(completed);
  lat.push(r1.ms, r2.ms);
  const s = await status();
  const [ct] = await q('SELECT * FROM contacts WHERE id=$1', [contactId]);
  check('call.completed -> status completed, ended_at=occurred_at, outcome=data',
    s.status === 'completed' && s.ended_at?.getTime() === endedAt.getTime() && canon(s.outcome) === canon(completed.data), s);
  check('duplicate delivery -> 2xx and not re-applied (attempts_count=1)', r2.status >= 200 && r2.status < 300 && ct.attempts_count === 1, { http: r2.status, attempts: ct.attempts_count });
  check('trigger: last_attempt_at = ended_at', ct.last_attempt_at?.getTime() === endedAt.getTime(), ct.last_attempt_at);
  check('trigger: outcome.do_not_call=true -> contacts.do_not_call=true', ct.do_not_call === true);

  const late = await webhook(ev(callId, 5, 'call.failed', { sip_code: 500 }));
  const stale = await webhook(ev(callId, 2, 'call.dialing'));
  const s2 = await status();
  const [ct2] = await q('SELECT attempts_count FROM contacts WHERE id=$1', [contactId]);
  check('later terminal / stale sequence accepted (2xx) but first terminal wins',
    late.status < 300 && stale.status < 300 && s2.status === 'completed' && ct2.attempts_count === 1, { late: late.status, stale: stale.status, status: s2.status, attempts: ct2.attempts_count });
  const [{ n: events }] = await q('SELECT count(*)::int AS n FROM webhook_events WHERE provider_call_id=$1', [callId]);
  check('all accepted unique events stored in webhook_events (5; same call+sequence = duplicate)', events === 5, events);
  const [evRow] = await q('SELECT correlation_id FROM webhook_events WHERE provider_event_id=$1', [completed.event_id]);
  check('correlation id propagated to webhook_events', evRow?.correlation_id === correlation, evRow);
  check('webhook latency < 1 s with slow/failing CRM', Math.max(...lat) < 1000, lat.map(Math.round));

  const noAnswer = await (async () => {
    const cc = await campaign(orgA);
    const id2 = await contact(orgA, cc);
    const b = (await claim(tA, cc)).body.contact.attempt_id;
    await webhook(ev(b, 1, 'call.no_answer', { sip_code: 486 }));
    const [a] = await q('SELECT status FROM call_attempts WHERE id=$1', [b]);
    const [k] = await q('SELECT attempts_count, do_not_call FROM contacts WHERE id=$1', [id2]);
    return a.status === 'no_answer' && k.attempts_count === 1 && k.do_not_call === false;
  })();
  check('call.no_answer is terminal; do_not_call untouched when absent', noAnswer);
  const unknown = await webhook(ev(`call_${randomUUID()}`, 1, 'call.dialing'));
  check('unknown call_id -> 404 (documented choice)', unknown.status === 404, unknown.status);

  const delivered = await until(() => crmRequests.find((x) => x.body.attempt_id === callId), 20000);
  check('CRM gets POST {attempt_id,status,outcome} after retries (slow + 503)',
    delivered && delivered.body.status === 'completed' && canon(delivered.body.outcome) === canon(completed.data)
      && Object.keys(delivered.body).sort().join() === 'attempt_id,outcome,status', delivered);
  check('CRM request carries the webhook correlation id', delivered?.correlation === correlation, delivered?.correlation);
}

const analysisCampaign = await campaign(orgA);
async function terminal(transcript) {
  const contactId = await contact(orgA, analysisCampaign);
  const [{ id }] = await q(
    `INSERT INTO call_attempts(org_id, campaign_id, contact_id, provider_call_id, status, ended_at, outcome, transcript)
     VALUES ($1, $2, $3, $4, 'completed', now(), '{}', $5) RETURNING id`,
    [orgA, analysisCampaign, contactId, `call_${randomUUID()}`, transcript]
  );
  return id;
}
const final = async (id) => until(async () => {
  const r = await call('GET', `/api/analyses/${id}`, tA);
  return ['completed', 'partial', 'error', 'cancelled'].includes(r.body?.status) ? r.body : null;
}, 15000);

console.log('\n# 7. analyses');
{

  const attempt = await terminal('Добрый день, это ... [ok]');
  const created = await call('POST', '/api/analyses', tA, { call_attempt_id: attempt });
  check('POST /api/analyses -> {id, status:"queued"}', created.body?.status === 'queued' && created.body.id && Object.keys(created.body).sort().join() === 'id,status', created);
  const id = created.body.id;
  const repeat = await call('POST', '/api/analyses', tA, { call_attempt_id: attempt });
  check('repeat POST returns the same analysis', repeat.body?.id === id, repeat);
  const stream = await readSse(`/api/analyses/${id}/stream`, tA);
  const chunks = stream.events.filter((e) => e.event === 'chunk');
  const done = stream.events.find((e) => e.event === 'done');
  check('stream is text/event-stream with chunk events carrying id (SSE id + data.id)',
    stream.contentType?.includes('text/event-stream') && chunks.length === 3 && chunks.every((e) => e.id && e.data.id === e.id), stream.events);
  check('done carries a schema-valid result', done?.data?.result?.next_step === 'send_proposal' && done.data.result.lead_score === 72, done);
  const got = await call('GET', `/api/analyses/${id}`, tA);
  check('GET returns status + accumulated result', got.body?.status === 'completed' && got.body.result?.summary && got.body.partial_result?.summary === 'Клиент заинтересован', got.body);
  const resumed = await readSse(`/api/analyses/${id}/stream`, tA, chunks[0].id);
  check('Last-Event-ID -> continuation only (no repeat)', resumed.events.length === 3 && resumed.events[0].id === chunks[1].id && resumed.events.at(-1).event === 'done', resumed.events.map((e) => `${e.event}:${e.id}`));
  check('provider called exactly once despite repeat POST/reconnect', providerCalls.get(id)?.n === 1, providerCalls.get(id));
  check('transcript read from call_attempts.transcript', providerCalls.get(id)?.transcript === 'Добрый день, это ... [ok]');

  const nullT = await call('POST', '/api/analyses', tA, { call_attempt_id: await terminal(null) });
  const nullF = await final(nullT.body.id);
  check('NULL transcript -> fallback stub sent, analysis still runs', providerCalls.get(nullT.body.id)?.transcript === FALLBACK && nullF.status === 'completed', nullF);

  const started429 = Date.now();
  const r429 = await call('POST', '/api/analyses', tA, { call_attempt_id: await terminal('[429]') });
  const f429 = await final(r429.body.id);
  check('429 + Retry-After:1 -> waits >=1s, retries, completes', f429.status === 'completed' && providerCalls.get(r429.body.id)?.n === 2 && Date.now() - started429 >= 1000, { f429, calls: providerCalls.get(r429.body.id) });

  const rb = await call('POST', '/api/analyses', tA, { call_attempt_id: await terminal('[break]') });
  const sb = await readSse(`/api/analyses/${rb.body.id}/stream`, tA);
  const fb = await final(rb.body.id);
  check('stream break after chunks -> partial, chunks kept, SSE error event', fb.status === 'partial' && fb.partial_result?.summary === 'Клиент ' && sb.events.at(-1)?.event === 'error', { fb, last: sb.events.at(-1) });
  check('no silent regeneration after break (1 provider call)', providerCalls.get(rb.body.id)?.n === 1);

  const re = await call('POST', '/api/analyses', tA, { call_attempt_id: await terminal('[break-empty]') });
  const fe = await final(re.body.id);
  check('stream break before any chunk -> error', fe.status === 'error', fe);

  const ri = await call('POST', '/api/analyses', tA, { call_attempt_id: await terminal('[invalid]') });
  const si = await readSse(`/api/analyses/${ri.body.id}/stream`, tA);
  const fi = await final(ri.body.id);
  check('done not matching schema (lead_score=150) -> error, never sent as done', fi.status === 'error' && fi.result === null && !si.events.some((e) => e.event === 'done'), fi);

  const rc = await call('POST', '/api/analyses', tA, { call_attempt_id: await terminal('[slow]') });
  await until(async () => (await call('GET', `/api/analyses/${rc.body.id}`, tA)).body?.partial_result?.summary, 5000);
  const cancel = await call('POST', `/api/analyses/${rc.body.id}/cancel`, tA);
  const fc = await final(rc.body.id);
  check('cancel mid-stream -> cancelled, chunks kept', cancel.status < 300 && fc.status === 'cancelled' && fc.partial_result?.summary?.startsWith('Клиент'), fc);

  check('foreign org: GET -> 404', (await call('GET', `/api/analyses/${id}`, tB)).status === 404);
  check('foreign org: stream -> 404', (await readSse(`/api/analyses/${id}/stream`, tB)).status === 404);
  check('foreign org: cancel -> 404', (await call('POST', `/api/analyses/${id}/cancel`, tB)).status === 404);
  check('foreign org: POST with other org attempt -> 404', (await call('POST', '/api/analyses', tB, { call_attempt_id: attempt })).status === 404);
  check('no JWT -> 401', (await fetch(`${api}/api/analyses/${id}`)).status === 401);
  check('analysis of a claimed-via-API terminal attempt works', (await call('POST', '/api/analyses', tA, { call_attempt_id: terminalAttempt })).status === 200);
}

console.log('\n# atomicity, retries, failures');
{
  const c = await campaign(orgA);
  const newAttempt = async () => {
    const contactId = await contact(orgA, c);
    const { body } = await claim(tA, c);
    return { contactId, attemptId: body.contact.attempt_id };
  };
  const attemptState = async (attemptId, eventId = '') => (await q(`
    SELECT a.status, c.attempts_count, c.do_not_call,
           (SELECT count(*)::int FROM webhook_events w WHERE w.provider_event_id = $2) AS stored,
           (SELECT count(*)::int FROM crm_outbox o WHERE o.attempt_id = a.id) AS outbox
      FROM call_attempts a JOIN contacts c ON c.id = a.contact_id WHERE a.id = $1`, [attemptId, eventId]))[0];

  // Webhook transaction is all-or-nothing: make the CRM outbox insert (inside the trigger) fail.
  const atom = await newAttempt();
  await webhook(ev(atom.attemptId, 1, 'call.dialing'));
  await q(`ALTER TABLE crm_outbox ADD CONSTRAINT acc_block CHECK (attempt_id <> '${atom.attemptId}'::uuid)`);
  const terminalEvent = ev(atom.attemptId, 2, 'call.completed', { do_not_call: true });
  const blocked = await webhook(terminalEvent);
  const afterFail = await attemptState(atom.attemptId, terminalEvent.event_id);
  await q('ALTER TABLE crm_outbox DROP CONSTRAINT acc_block');
  check('failure inside terminal transaction -> 5xx (provider retries), nothing half-applied',
    blocked.status >= 500 && afterFail.status === 'dialing' && afterFail.attempts_count === 0 && afterFail.do_not_call === false
      && afterFail.stored === 0 && afterFail.outbox === 0, { http: blocked.status, afterFail });
  const retried = await webhook(terminalEvent);
  const afterRetry = await attemptState(atom.attemptId, terminalEvent.event_id);
  check('provider retry of the same event then applies it exactly once', retried.status === 200 && afterRetry.status === 'completed'
    && afterRetry.attempts_count === 1 && afterRetry.do_not_call === true && afterRetry.stored === 1 && afterRetry.outbox === 1, afterRetry);

  const race = await newAttempt();
  const dupEvent = ev(race.attemptId, 1, 'call.no_answer', { sip_code: 486 });
  const burst = await Promise.all(Array.from({ length: 10 }, () => webhook(dupEvent)));
  const raceState = await attemptState(race.attemptId, dupEvent.event_id);
  check('10 concurrent deliveries of one event: all 2xx, stored/applied/queued once', burst.every((r) => r.status === 200)
    && raceState.attempts_count === 1 && raceState.stored === 1 && raceState.outbox === 1, { statuses: burst.map((r) => r.status), raceState });

  const two = await newAttempt();
  await Promise.all([webhook(ev(two.attemptId, 5, 'call.completed')), webhook(ev(two.attemptId, 6, 'call.failed'))]);
  const twoState = await attemptState(two.attemptId);
  check('two different terminal events concurrently: side effects and CRM row once', twoState.attempts_count === 1 && twoState.outbox === 1, twoState);

  // CRM delivery: rejects and failures are retried until a 2xx, then never re-sent.
  const scenarios = [
    ['500, 500, ok', ['500', '500', 'ok']],
    ['400 (4xx is not success), ok', ['400', 'ok']],
    ['connection drop, ok', ['drop', 'ok']],
    ['timeout > 10 s, ok', ['hang', 'ok']]
  ];
  const crmCases = [];
  for (const [label, plan] of scenarios) {
    const x = await newAttempt();
    crmScript.set(x.attemptId, [...plan]);
    await webhook(ev(x.attemptId, 1, 'call.completed'));
    crmCases.push({ label, plan, attemptId: x.attemptId });
  }
  for (const item of crmCases) {
    const row = await until(async () => (await q(`SELECT status, attempts, last_error FROM crm_outbox WHERE attempt_id = $1 AND status = 'delivered'`, [item.attemptId]))[0], 45_000);
    const trace = crmTrace.get(item.attemptId) ?? [];
    check(`CRM ${item.label} -> delivered after ${item.plan.length - 1} failed tries, Idempotency-Key = attempt_id`,
      row?.status === 'delivered' && row.attempts === item.plan.length - 1 && trace.length === item.plan.length && trace.every((t) => t.key === item.attemptId),
      { row, trace: trace.map((t) => t.step) });
  }
  await sleep(3000);
  check('CRM: no re-send after a 2xx', crmCases.every((item) => (crmTrace.get(item.attemptId) ?? []).length === item.plan.length));

  // Analysis: provider failures inside the job.
  const failures = [
    ['provider HTTP 500 -> error', '[500]', 'error', 'PROVIDER_HTTP_500', 1],
    ['provider 200 but not text/event-stream -> error', '[json]', 'error', 'INVALID_PROVIDER_RESPONSE', 1],
    ['malformed chunk JSON after a valid chunk -> partial, chunk kept', '[badchunk]', 'partial', 'INVALID_PROVIDER_EVENT', 1],
    ['429 forever -> bounded retries (1 + 3) -> error', '[429x]', 'error', 'PROVIDER_RATE_LIMITED', 4],
    ['429 with invalid Retry-After -> error', '[badretry]', 'error', 'INVALID_RETRY_AFTER', 1]
  ];
  for (const [label, transcript, status, code, calls] of failures) {
    const created = await call('POST', '/api/analyses', tA, { call_attempt_id: await terminal(transcript) });
    const state = await final(created.body.id);
    check(`analysis: ${label}`, state?.status === status && state.error?.code === code && providerCalls.get(created.body.id)?.n === calls,
      { status: state?.status, code: state?.error?.code, calls: providerCalls.get(created.body.id)?.n });
  }

  // Worker crashed before the provider stream started: the job is re-queued and runs once.
  const lost = await terminal('regular after crash');
  const [{ id: lostId }] = await q(`INSERT INTO analyses(org_id, call_attempt_id, status, lease_until, lease_token)
    VALUES ($1, $2, 'streaming', now() - interval '1 minute', gen_random_uuid()) RETURNING id`, [orgA, lost]);
  const lostState = await final(lostId);
  check('crashed before provider stream -> re-queued and completed, provider called once',
    lostState?.status === 'completed' && providerCalls.get(lostId)?.n === 1, { status: lostState?.status, calls: providerCalls.get(lostId)?.n });
}

console.log('\n# 2. launch contract');
{
  check('GET /healthz -> 200', (await fetch(`${api}/healthz`)).status === 200);
  const ui = await fetch('http://localhost:5173/').catch(() => null);
  check('UI served on :5173', ui?.status === 200);
  check('/dev/token is not exposed by default', (await fetch(`${api}/dev/token`, { method: 'POST' })).status === 404);
}

crm.close();
provider.close();
await db.end();
console.log(`\n${failed === 0 ? 'ALL PASS' : `${failed} FAILED`}`);
process.exit(failed === 0 ? 0 : 1);
