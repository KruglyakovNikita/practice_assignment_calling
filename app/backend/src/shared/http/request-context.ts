import type { Request } from 'express';
import type { authenticatedPrincipal } from '../auth/auth-types';

export type requestContext = Request & {
  correlationId: string;
  principal?: authenticatedPrincipal;
  rawBody?: Buffer;
};
