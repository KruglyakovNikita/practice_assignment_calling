import { Inject, Injectable } from '@nestjs/common';
import type { Pool } from 'pg';
import { CALL_EVENT_PORT, CallNotFoundError, type callEventPort, type receiveCallEventResult } from '../../application/ports/call-event.port';
import { applyCallEvent } from '../../domain/apply-call-event';
import type { callAttemptStatus, callEvent } from '../../domain/call-event';
import { ADMIN_DB_POOL } from '../../../shared/database/tokens';

@Injectable()
export class CallEventRepository implements callEventPort {
  static readonly token = CALL_EVENT_PORT;

  constructor(@Inject(ADMIN_DB_POOL) private readonly pool: Pool) {}

  async receive(event: callEvent): Promise<receiveCallEventResult> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const attemptResult = await client.query<{
        id: string;
        org_id: string;
        status: callAttemptStatus;
        started_at: Date | null;
        ended_at: Date | null;
        last_sequence: string | null;
      }>(`
        SELECT id, org_id, status, started_at, ended_at, last_sequence
          FROM public.call_attempts
         WHERE provider_call_id = $1
         FOR UPDATE
      `, [event.callId]);

      const row = attemptResult.rows[0];
      if (!row) {
        throw new CallNotFoundError();
      }

      const inserted = await client.query<{ id: string }>(`
        INSERT INTO public.webhook_events(
          provider_event_id, provider_call_id, sequence, type, payload, org_id, correlation_id
        ) VALUES ($1, $2, $3::bigint, $4, $5::jsonb, $6::uuid, $7)
        ON CONFLICT DO NOTHING
        RETURNING id
      `, [
        event.eventId,
        event.callId,
        event.sequence.toString(),
        event.type,
        event.rawPayload,
        row.org_id,
        event.correlationId
      ]);

      if (inserted.rowCount === 0) {
        await client.query('COMMIT');
        return { duplicate: true };
      }

      const patch = applyCallEvent({
        id: row.id,
        orgId: row.org_id,
        status: row.status,
        startedAt: row.started_at,
        endedAt: row.ended_at,
        lastSequence: row.last_sequence === null ? null : BigInt(row.last_sequence)
      }, event);

      await client.query(`
        UPDATE public.call_attempts
           SET status = COALESCE($2::text, status),
               started_at = COALESCE(started_at, $3::timestamptz),
               ended_at = COALESCE($4::timestamptz, ended_at),
               outcome = COALESCE($5::jsonb, outcome),
               last_sequence = COALESCE($6::bigint, last_sequence),
               correlation_id = COALESCE($7::text, correlation_id)
         WHERE id = $1::uuid
      `, [
        row.id,
        patch.status ?? null,
        patch.startedAt?.toISOString() ?? null,
        patch.endedAt?.toISOString() ?? null,
        patch.outcome === undefined ? null : JSON.stringify(patch.outcome),
        patch.lastSequence?.toString() ?? null,
        patch.correlationId ?? null
      ]);

      await client.query('COMMIT');
      return { duplicate: false };
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }
}
