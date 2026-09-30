import assert from 'node:assert/strict';
import test from 'node:test';
import { parseProviderSse } from '../src/analyses/adapters/http/provider-sse-parser';

function streamOf(parts: string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  return new ReadableStream({
    start(controller) {
      for (const part of parts) controller.enqueue(encoder.encode(part));
      controller.close();
    }
  });
}

test('provider SSE parser handles split chunks and done', async () => {
  const stream = streamOf([
    'event: chunk\r\ndata: {"field":"summary",',
    '"delta":"hello"}\r\n\r\nevent: done\n',
    'data: {"result":{"summary":"hello","objections":[],"next_step":"call_back","lead_score":80,"confidence":0.8}}\n\n'
  ]);

  const events = [];
  for await (const event of parseProviderSse(stream)) events.push(event);
  assert.equal(events.length, 2);
  assert.deepEqual(events[0], { type: 'chunk', field: 'summary', delta: 'hello' });
  assert.equal(events[1]?.type, 'done');
});

test('provider SSE parser rejects malformed provider events', async () => {
  const stream = streamOf(['event: chunk\ndata: {"field":"summary"}\n\n']);
  await assert.rejects(async () => {
    for await (const _event of parseProviderSse(stream)) {
      void _event;
    }
  }, /Invalid provider chunk event/);
});
