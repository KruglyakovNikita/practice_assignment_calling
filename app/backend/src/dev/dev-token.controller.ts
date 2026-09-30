import { BadRequestException, Body, Controller, HttpCode, Inject, Post } from '@nestjs/common';
import { z } from 'zod';
import { RUNTIME_CONFIG } from '../shared/config/config.module';
import type { runtimeConfig } from '../shared/config/runtime-config';
import { signJwt } from '../shared/auth/sign-jwt';

const bodySchema = z.object({
  org_id: z.string().uuid(),
  sub: z.string().min(1),
  role: z.enum(['worker', 'authenticated'])
}).strict();

// ponytail: dev-only convenience for local UI, no auth guard — same trust level as the CLI script it wraps.
@Controller('dev')
export class DevTokenController {
  constructor(@Inject(RUNTIME_CONFIG) private readonly config: runtimeConfig) {}

  @Post('token')
  @HttpCode(200)
  issue(@Body() body: unknown): { token: string } {
    const parsed = bodySchema.safeParse(body);
    if (!parsed.success) {
      throw new BadRequestException({ code: 'INVALID_REQUEST' });
    }

    const token = signJwt({
      orgId: parsed.data.org_id,
      sub: parsed.data.sub,
      role: parsed.data.role,
      secret: this.config.jwtSecret
    });
    return { token };
  }
}
