import type { NextFunction, Response } from 'express';
import type { requestContext } from './request-context';

export function requestLogMiddleware(req: requestContext, res: Response, next: NextFunction): void {
  const started = process.hrtime.bigint();
  res.on('finish', () => {
    const durationMs = Number(process.hrtime.bigint() - started) / 1_000_000;
    process.stdout.write(`${JSON.stringify({
      level: 'info',
      time: new Date().toISOString(),
      event: 'http_request',
      correlation_id: req.correlationId,
      method: req.method,
      path: req.path,
      status_code: res.statusCode,
      duration_ms: Math.round(durationMs * 100) / 100
    })}\n`);
  });
  next();
}
