// Dev stub of the external CRM: slow and rejecting part of the requests, like the task's checker.
import { createServer } from 'node:http';

const port = Number(process.env.PORT ?? 18081);
const delayMs = Number(process.env.CRM_DELAY_MS ?? 1500);
const failRate = Number(process.env.CRM_FAIL_RATE ?? 0.3);

createServer(async (req, res) => {
  let body = '';
  for await (const chunk of req) body += chunk;
  await new Promise((resolve) => setTimeout(resolve, delayMs));
  const ok = Math.random() >= failRate;
  process.stdout.write(`${JSON.stringify({ ok, correlation_id: req.headers['x-correlation-id'], body: JSON.parse(body || '{}') })}\n`);
  res.writeHead(ok ? 200 : 503).end();
}).listen(port, '0.0.0.0', () => {
  process.stdout.write(`Mock CRM listening on http://0.0.0.0:${port}\n`);
});
