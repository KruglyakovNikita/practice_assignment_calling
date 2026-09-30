import { z } from 'zod';
import { AnalysisProviderError, type providerEvent } from '../../application/ports/analysis-provider.port';

const chunkSchema = z.object({ field: z.string().min(1), delta: z.string() }).strict();
const doneSchema = z.object({ result: z.unknown() }).strict();

export async function* parseProviderSse(stream: ReadableStream<Uint8Array>): AsyncGenerator<providerEvent> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let eventName = '';
  let dataLines: string[] = [];

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      while (true) {
        const newline = buffer.indexOf('\n');
        if (newline < 0) break;
        let line = buffer.slice(0, newline);
        buffer = buffer.slice(newline + 1);
        if (line.endsWith('\r')) line = line.slice(0, -1);

        if (line === '') {
          const event = parseEvent(eventName, dataLines);
          eventName = '';
          dataLines = [];
          if (event) yield event;
          continue;
        }
        if (line.startsWith(':')) continue;
        if (line.startsWith('event:')) eventName = line.slice(6).trimStart();
        if (line.startsWith('data:')) dataLines.push(line.slice(5).trimStart());
      }
    }
  } catch (error) {
    if (error instanceof AnalysisProviderError) throw error;
    throw new AnalysisProviderError('PROVIDER_STREAM_ERROR', 'Provider stream failed');
  } finally {
    reader.releaseLock();
  }
}

function parseEvent(eventName: string, dataLines: string[]): providerEvent | null {
  if (!eventName && dataLines.length === 0) return null;
  if (eventName !== 'chunk' && eventName !== 'done') {
    throw new AnalysisProviderError('INVALID_PROVIDER_EVENT', `Unsupported provider event: ${eventName || 'message'}`);
  }

  let data: unknown;
  try {
    data = JSON.parse(dataLines.join('\n')) as unknown;
  } catch {
    throw new AnalysisProviderError('INVALID_PROVIDER_EVENT', 'Provider SSE data is not valid JSON');
  }

  if (eventName === 'chunk') {
    const parsed = chunkSchema.safeParse(data);
    if (!parsed.success) throw new AnalysisProviderError('INVALID_PROVIDER_EVENT', 'Invalid provider chunk event');
    return { type: 'chunk', field: parsed.data.field, delta: parsed.data.delta };
  }

  const parsed = doneSchema.safeParse(data);
  if (!parsed.success) throw new AnalysisProviderError('INVALID_PROVIDER_EVENT', 'Invalid provider done event');
  return { type: 'done', result: parsed.data.result };
}
