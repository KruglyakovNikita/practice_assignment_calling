import { randomUUID } from 'node:crypto';
import type { NextFunction, Response } from 'express';
import type { requestContext } from './request-context';

const correlationPattern = /^[A-Za-z0-9._:-]{1,128}$/;

export function correlationIdMiddleware(req: requestContext, res: Response, next: NextFunction): void {
  const incoming = req.header('x-correlation-id');
  req.correlationId = incoming && correlationPattern.test(incoming) ? incoming : randomUUID();
  res.setHeader('x-correlation-id', req.correlationId);
  next();
}
