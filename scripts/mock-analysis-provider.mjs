import { createServer } from 'node:http';

const port = Number(process.env.PORT ?? 18082);
const server = createServer(async (req, res) => {
  if (req.method !== 'POST' || req.url !== '/v1/analyze') {
    res.writeHead(404).end();
    return;
  }

  const chunks = [];
  for await (const chunk of req) chunks.push(Buffer.from(chunk));
  const body = JSON.parse(Buffer.concat(chunks).toString('utf8'));

  res.writeHead(200, {
    'content-type': 'text/event-stream',
    'cache-control': 'no-cache',
    connection: 'keep-alive'
  });
  res.write(`event: chunk\ndata: ${JSON.stringify({ field: 'summary', delta: `Анализ ${body.request_id}: ` })}\n\n`);
  setTimeout(() => {
    res.write(`event: chunk\ndata: ${JSON.stringify({ field: 'summary', delta: 'клиент заинтересован' })}\n\n`);
    res.end(`event: done\ndata: ${JSON.stringify({
      result: {
        summary: 'Клиент заинтересован',
        objections: [],
        next_step: 'call_back',
        lead_score: 80,
        confidence: 0.85
      }
    })}\n\n`);
  }, 400);
});

server.listen(port, '0.0.0.0', () => {
  process.stdout.write(`Mock analysis provider listening on http://0.0.0.0:${port}\n`);
});
