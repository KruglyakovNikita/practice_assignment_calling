export type sseMessage = {
  id: string;
  event: string;
  data: unknown;
};

export async function readSse(
  response: Response,
  signal: AbortSignal,
  onMessage: (message: sseMessage) => void
): Promise<void> {
  if (!response.body) throw new Error('SSE response has no body');
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let id = '';
  let event = 'message';
  let dataLines: string[] = [];

  try {
    while (!signal.aborted) {
      const { done, value } = await reader.read();
      if (done) return;
      buffer += decoder.decode(value, { stream: true });

      while (true) {
        const newline = buffer.indexOf('\n');
        if (newline < 0) break;
        let line = buffer.slice(0, newline);
        buffer = buffer.slice(newline + 1);
        if (line.endsWith('\r')) line = line.slice(0, -1);

        if (line === '') {
          if (dataLines.length > 0) {
            const raw = dataLines.join('\n');
            onMessage({ id, event, data: JSON.parse(raw) as unknown });
          }
          id = '';
          event = 'message';
          dataLines = [];
          continue;
        }
        if (line.startsWith(':')) continue;
        if (line.startsWith('id:')) id = line.slice(3).trimStart();
        if (line.startsWith('event:')) event = line.slice(6).trimStart();
        if (line.startsWith('data:')) dataLines.push(line.slice(5).trimStart());
      }
    }
  } finally {
    await reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
}
