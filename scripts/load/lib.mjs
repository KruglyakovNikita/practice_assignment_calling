import { createHmac } from 'node:crypto';
import { readFileSync } from 'node:fs';

export function loadEnv(path = '.env') {
  try {
    for (const line of readFileSync(path, 'utf8').split(/\r?\n/)) {
      const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
      if (match && process.env[match[1]] === undefined) process.env[match[1]] = match[2];
    }
  } catch {
    // .env is optional; explicit env vars win.
  }
}

const b64url = (value) => Buffer.from(value).toString('base64url');

export function signJwt(claims, secret) {
  const head = b64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const body = b64url(JSON.stringify({ iat: Math.floor(Date.now() / 1000), ...claims }));
  const sig = createHmac('sha256', secret).update(`${head}.${body}`).digest('base64url');
  return `${head}.${body}.${sig}`;
}

export function signBody(body, secret) {
  return `sha256=${createHmac('sha256', secret).update(body).digest('hex')}`;
}

export function stats(samples) {
  const sorted = [...samples].sort((a, b) => a - b);
  const pick = (p) => sorted[Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1)] ?? 0;
  const round = (n) => Math.round(n * 100) / 100;
  return {
    count: sorted.length,
    p50_ms: round(pick(50)),
    p95_ms: round(pick(95)),
    p99_ms: round(pick(99)),
    max_ms: round(sorted.at(-1) ?? 0)
  };
}

export function arg(name, fallback) {
  const hit = process.argv.find((item) => item.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : fallback;
}
