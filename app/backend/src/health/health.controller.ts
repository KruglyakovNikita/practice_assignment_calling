import { Controller, Get, Inject, ServiceUnavailableException } from '@nestjs/common';
import type { Pool } from 'pg';
import { ADMIN_DB_POOL } from '../shared/database/tokens';

@Controller()
export class HealthController {
  constructor(@Inject(ADMIN_DB_POOL) private readonly pool: Pool) {}

  @Get('healthz')
  health(): { ok: true } {
    return { ok: true };
  }

  @Get('readyz')
  async ready(): Promise<{ ok: true }> {
    try {
      await this.pool.query('SELECT 1');
      return { ok: true };
    } catch {
      throw new ServiceUnavailableException({ code: 'DATABASE_UNAVAILABLE' });
    }
  }
}
