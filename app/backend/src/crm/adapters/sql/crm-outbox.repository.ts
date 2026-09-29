import { Inject, Injectable } from '@nestjs/common';
import type { Pool } from 'pg';
import { ADMIN_DB_POOL } from '../../../shared/database/tokens';
import type { crmOutboxPort, leasedCrmMessage } from '../../application/ports/crm-outbox.port';

@Injectable()
export class CrmOutboxRepository implements crmOutboxPort {
  constructor(@Inject(ADMIN_DB_POOL) private readonly pool: Pool) {}

  async leaseBatch(limit: number, leaseMs: number): Promise<leasedCrmMessage[]> {
    const result = await this.pool.query<{
      id: string;
      lease_token: string;
      attempts: number;
      payload: Record<string, unknown>;
      correlation_id: string | null;
    }>(`
      WITH picked AS (
        SELECT id
          FROM public.crm_outbox
         WHERE (
           status = 'pending' AND next_attempt_at <= now()
         ) OR (
           status = 'delivering' AND lease_until < now()
         )
         ORDER BY next_attempt_at, id
         FOR UPDATE SKIP LOCKED
         LIMIT $1
      )
      UPDATE public.crm_outbox o
         SET status = 'delivering',
             lease_token = gen_random_uuid(),
             lease_until = now() + ($2::bigint * interval '1 millisecond'),
             updated_at = now()
        FROM picked
       WHERE o.id = picked.id
      RETURNING o.id, o.lease_token, o.attempts, o.payload, o.correlation_id
    `, [limit, leaseMs]);

    return result.rows.map((row: { id: string; lease_token: string; attempts: number; payload: Record<string, unknown>; correlation_id: string | null }) => ({
      id: row.id,
      leaseToken: row.lease_token,
      attempts: row.attempts,
      payload: row.payload,
      correlationId: row.correlation_id
    }));
  }

  async markDelivered(id: string, leaseToken: string): Promise<void> {
    await this.pool.query(`
      UPDATE public.crm_outbox
         SET status = 'delivered',
             delivered_at = now(),
             lease_until = NULL,
             lease_token = NULL,
             last_error = NULL,
             updated_at = now()
       WHERE id = $1::uuid
         AND lease_token = $2::uuid
         AND status = 'delivering'
    `, [id, leaseToken]);
  }

  async markFailed(input: {
    id: string;
    leaseToken: string;
    errorCode: string;
    retryAt: Date;
    dead: boolean;
  }): Promise<void> {
    await this.pool.query(`
      UPDATE public.crm_outbox
         SET status = CASE WHEN $5::boolean THEN 'dead' ELSE 'pending' END,
             attempts = attempts + 1,
             next_attempt_at = $4::timestamptz,
             lease_until = NULL,
             lease_token = NULL,
             last_error = $3,
             updated_at = now()
       WHERE id = $1::uuid
         AND lease_token = $2::uuid
         AND status = 'delivering'
    `, [input.id, input.leaseToken, input.errorCode, input.retryAt.toISOString(), input.dead]);
  }
}
