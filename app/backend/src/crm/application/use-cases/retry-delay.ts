export function retryDelayMs(attempt: number, baseMs: number, maxMs: number): number {
  return Math.min(baseMs * 2 ** Math.min(Math.max(attempt, 0), 30), maxMs);
}
