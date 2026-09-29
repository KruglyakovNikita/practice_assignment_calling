import { Inject, Injectable } from '@nestjs/common';
import type { Pool } from 'pg';
import type { claimContactCommand, claimedContact, contactClaimPort } from '../../application/ports/contact-claim.port';
import { APP_DB_POOL } from '../../../shared/database/tokens';

@Injectable()
export class ContactClaimRepository implements contactClaimPort {
  constructor(@Inject(APP_DB_POOL) private readonly pool: Pool) {}

  async claim(command: claimContactCommand): Promise<claimedContact | null> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(`SELECT set_config('app.jwt', $1, true)`, [command.tenantToken]);
      const result = await client.query<{
        id: string;
        phone_e164: string;
        attempt_id: string;
      }>('SELECT * FROM public.claim_next_contact($1::uuid)', [command.campaignId]);
      await client.query('COMMIT');

      const row = result.rows[0];
      if (!row) return null;
      return { id: row.id, phoneE164: row.phone_e164, attemptId: row.attempt_id };
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }
}
