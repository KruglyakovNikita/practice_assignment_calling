// Parallel dialer workers hammering POST /rpc/claim_next_contact.
// node scripts/load/claim.mjs --org=<uuid> --campaign=<uuid> --workers=20 --seconds=30
import { arg, loadEnv, signJwt, stats } from './lib.mjs';

loadEnv();
const api = arg('api', process.env.API_URL ?? 'http://localhost:8080');
const org = arg('org');
const campaign = arg('campaign');
const workers = Number(arg('workers', '20'));
const seconds = Number(arg('seconds', '30'));
if (!org || !campaign) throw new Error('--org and --campaign are required');

const token = signJwt({ sub: 'load-worker', org_id: org, role: 'worker' }, process.env.JWT_SECRET);
const latencies = [];
const errors = {};
const attemptIds = new Set();
let empty = 0;
const deadline = Date.now() + seconds * 1000;

async function worker() {
  while (Date.now() < deadline) {
    const started = performance.now();
    try {
      const response = await fetch(`${api}/rpc/claim_next_contact`, {
        method: 'POST',
        headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
        body: JSON.stringify({ campaign_id: campaign })
      });
      const body = await response.json();
      latencies.push(performance.now() - started);
      if (response.status !== 200) {
        errors[response.status] = (errors[response.status] ?? 0) + 1;
      } else if (body.contact === null) {
        empty += 1;
      } else if (attemptIds.has(body.contact.id)) {
        errors.duplicate_contact = (errors.duplicate_contact ?? 0) + 1;
      } else {
        attemptIds.add(body.contact.id);
      }
    } catch (error) {
      errors[error.code ?? 'network'] = (errors[error.code ?? 'network'] ?? 0) + 1;
    }
  }
}

await Promise.all(Array.from({ length: workers }, worker));
console.log(JSON.stringify({
  scenario: 'claim_next_contact',
  workers,
  seconds,
  rps: Math.round(latencies.length / seconds),
  claimed_unique_contacts: attemptIds.size,
  empty,
  errors,
  latency: stats(latencies)
}, null, 2));
