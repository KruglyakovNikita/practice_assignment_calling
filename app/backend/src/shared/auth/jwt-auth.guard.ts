import { CanActivate, ExecutionContext, Inject, Injectable, UnauthorizedException } from '@nestjs/common';
import { verify } from 'jsonwebtoken';
import { z } from 'zod';
import type { runtimeConfig } from '../config/runtime-config';
import { RUNTIME_CONFIG } from '../config/config.module';
import type { requestContext } from '../http/request-context';

const claimsSchema = z.object({
  sub: z.string().min(1),
  org_id: z.string().uuid(),
  role: z.enum(['worker', 'authenticated'])
});

@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(@Inject(RUNTIME_CONFIG) private readonly config: runtimeConfig) {}

  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest<requestContext>();
    const authorization = req.header('authorization');
    if (!authorization?.startsWith('Bearer ')) {
      throw new UnauthorizedException({ code: 'UNAUTHORIZED' });
    }

    const token = authorization.slice('Bearer '.length).trim();
    try {
      const decoded = verify(token, this.config.jwtSecret, { algorithms: ['HS256'] });
      const claims = claimsSchema.parse(decoded);
      req.principal = {
        sub: claims.sub,
        orgId: claims.org_id,
        role: claims.role,
        token
      };
      return true;
    } catch {
      throw new UnauthorizedException({ code: 'UNAUTHORIZED' });
    }
  }
}
