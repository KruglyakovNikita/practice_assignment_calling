// Dev stub of the LLM provider contract (task 7.1). Behaviour is picked by a marker in the
// transcript: [429] first call rate-limited, [break] stream cut after one chunk,
// [invalid] done result breaks the schema, [slow] never finishes (for cancel/reconnect).
import { createServer } from 'node:http';

const port = Number(process.env.PORT ?? 18082);
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const seen = new Map();

const server = createServer(async (req, res) => {
  if (req.method !== 'POST' || req.url !== '/v1/analyze') {
    res.writeHead(404).end();
    return;
  }

  let raw = '';
  for await (const chunk of req) raw += chunk;
  const { request_id: requestId, transcript = '' } = JSON.parse(raw);
  const calls = (seen.get(requestId) ?? 0) + 1;
  seen.set(requestId, calls);

  if (transcript.includes('[429]') && calls === 1) {
    res.writeHead(429, { 'retry-after': '2' }).end();
    return;
  }

  res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache', connection: 'keep-alive' });
  const chunk = (field, delta) => res.write(`event: chunk\ndata: ${JSON.stringify({ field, delta })}\n\n`);

  for (const word of ['Клиент ', 'интересуется ', 'тарифом, ', 'просит ', 'прислать ', 'предложение.']) {
    chunk('summary', word);
    await sleep(400);
    if (transcript.includes('[break]')) {
      res.socket.destroy();
      return;
    }
  }
  if (transcript.includes('[slow]')) {
    const timer = setInterval(() => chunk('summary', '.'), 1000);
    res.on('close', () => clearInterval(timer));
    return;
  }
  chunk('objections', 'дорого');
  await sleep(400);
  chunk('next_step', 'send_proposal');

  const result = {
    summary: 'Клиент интересуется тарифом, просит прислать предложение.',
    objections: ['дорого'],
    next_step: 'send_proposal',
    lead_score: transcript.includes('[invalid]') ? 150 : 72,
    confidence: 0.8
  };
  res.end(`event: done\ndata: ${JSON.stringify({ result })}\n\n`);
});

server.listen(port, '0.0.0.0', () => {
  process.stdout.write(`Mock analysis provider listening on http://0.0.0.0:${port}\n`);
});
