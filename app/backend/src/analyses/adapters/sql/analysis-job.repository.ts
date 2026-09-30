import { Inject, Injectable } from '@nestjs/common';
import type { analysisResult } from '@auto-calling/contracts';
import type { Pool, PoolClient } from 'pg';
import { ADMIN_DB_POOL } from '../../../shared/database/tokens';
import type { analysisJob, analysisJobPort } from '../../application/ports/analysis-job.port';

@Injectable()
export class AnalysisJobRepository implements analysisJobPort {
  constructor(@Inject(ADMIN_DB_POOL) private readonly pool: Pool) {}

  async claimNext(leaseMs: number): Promise<analysisJob | null> {
    const result = await this.pool.query<{
      id: string;
      org_id: string;
      call_attempt_id: string;
      transcript: string | null;
      lease_token: string;
    }>(`
      WITH picked AS (
        SELECT id
          FROM public.analyses
         WHERE status = 'queued'
           AND cancel_requested = false
         ORDER BY created_at, id
         FOR UPDATE SKIP LOCKED
         LIMIT 1
      ), claimed AS (
        UPDATE public.analyses a
           SET status = 'streaming',
               provider_started_at = COALESCE(provider_started_at, now()),
               lease_token = gen_random_uuid(),
               lease_until = now() + ($1::bigint * interval '1 millisecond'),
               updated_at = now()
          FROM picked
         WHERE a.id = picked.id
        RETURNING a.id, a.org_id, a.call_attempt_id, a.lease_token
      )
      SELECT c.id, c.org_id, c.call_attempt_id, ca.transcript, c.lease_token
        FROM claimed c
        JOIN public.call_attempts ca ON ca.id = c.call_attempt_id
    `, [leaseMs]);

    const row = result.rows[0];
    return row ? {
      id: row.id,
      orgId: row.org_id,
      callAttemptId: row.call_attempt_id,
      transcript: row.transcript,
      leaseToken: row.lease_token
    } : null;
  }

  async renewLease(analysisId: string, leaseToken: string, leaseMs: number): Promise<boolean> {
    const result = await this.pool.query(`
      UPDATE public.analyses
         SET lease_until = now() + ($3::bigint * interval '1 millisecond'),
             updated_at = now()
       WHERE id = $1::uuid
         AND lease_token = $2::uuid
         AND status = 'streaming'
         AND cancel_requested = false
    `, [analysisId, leaseToken, leaseMs]);
    return result.rowCount === 1;
  }

  async isCancellationRequested(analysisId: string, leaseToken: string): Promise<boolean> {
    const result = await this.pool.query<{ cancel_requested: boolean }>(`
      SELECT cancel_requested
        FROM public.analyses
       WHERE id = $1::uuid
         AND lease_token = $2::uuid
         AND status = 'streaming'
    `, [analysisId, leaseToken]);
    return result.rows[0]?.cancel_requested ?? true;
  }

  async appendChunk(input: {
    analysisId: string;
    leaseToken: string;
    field: string;
    delta: string;
  }): Promise<boolean> {
    return this.inTransaction(async (client) => {
      const updated = await client.query<{ org_id: string }>(`
        UPDATE public.analyses
           SET partial_result = jsonb_set(
                 partial_result,
                 ARRAY[$3]::text[],
                 to_jsonb(COALESCE(partial_result ->> $3, '') || $4::text),
                 true
               ),
               updated_at = now()
         WHERE id = $1::uuid
           AND lease_token = $2::uuid
           AND status = 'streaming'
           AND cancel_requested = false
        RETURNING org_id
      `, [input.analysisId, input.leaseToken, input.field, input.delta]);
      const row = updated.rows[0];
      if (!row) return false;

      await client.query(`
        WITH next_event AS (
          SELECT nextval('public.analysis_events_id_seq') AS id
        )
        INSERT INTO public.analysis_events(id, analysis_id, org_id, event_type, payload)
        SELECT id,
               $1::uuid,
               $2::uuid,
               'chunk',
               jsonb_build_object('id', id::text, 'field', $3::text, 'delta', $4::text)
          FROM next_event
      `, [input.analysisId, row.org_id, input.field, input.delta]);
      return true;
    });
  }

  async complete(input: {
    analysisId: string;
    leaseToken: string;
    result: analysisResult;
  }): Promise<boolean> {
    return this.finish(input.analysisId, input.leaseToken, async (client, orgId) => {
      const updated = await client.query(`
        UPDATE public.analyses
           SET status = 'completed',
               result = $3::jsonb,
               error_code = NULL,
               error_message = NULL,
               lease_until = NULL,
               lease_token = NULL,
               updated_at = now()
         WHERE id = $1::uuid
           AND lease_token = $2::uuid
           AND status = 'streaming'
           AND cancel_requested = false
      `, [input.analysisId, input.leaseToken, JSON.stringify(input.result)]);
      if (updated.rowCount !== 1) return false;

      await client.query(`
        INSERT INTO public.analysis_events(analysis_id, org_id, event_type, payload)
        VALUES ($1::uuid, $2::uuid, 'done', $3::jsonb)
      `, [input.analysisId, orgId, JSON.stringify({ result: input.result })]);
      return true;
    });
  }

  async fail(input: {
    analysisId: string;
    leaseToken: string;
    code: string;
    message: string;
    partial: boolean;
  }): Promise<boolean> {
    const status = input.partial ? 'partial' : 'error';
    return this.finish(input.analysisId, input.leaseToken, async (client, orgId) => {
      const updated = await client.query(`
        UPDATE public.analyses
           SET status = $3,
               error_code = $4,
               error_message = $5,
               lease_until = NULL,
               lease_token = NULL,
               updated_at = now()
         WHERE id = $1::uuid
           AND lease_token = $2::uuid
           AND status = 'streaming'
           AND cancel_requested = false
      `, [input.analysisId, input.leaseToken, status, input.code, input.message]);
      if (updated.rowCount !== 1) return false;

      await client.query(`
        INSERT INTO public.analysis_events(analysis_id, org_id, event_type, payload)
        VALUES ($1::uuid, $2::uuid, 'error', $3::jsonb)
      `, [input.analysisId, orgId, JSON.stringify({ code: input.code, message: input.message, status })]);
      return true;
    });
  }

  async cancel(analysisId: string, leaseToken: string): Promise<boolean> {
    return this.finish(analysisId, leaseToken, async (client, orgId) => {
      const updated = await client.query(`
        UPDATE public.analyses
           SET status = 'cancelled',
               cancel_requested = true,
               error_code = 'CANCELLED',
               error_message = 'Analysis cancelled',
               lease_until = NULL,
               lease_token = NULL,
               updated_at = now()
         WHERE id = $1::uuid
           AND lease_token = $2::uuid
           AND status = 'streaming'
      `, [analysisId, leaseToken]);
      if (updated.rowCount !== 1) return false;

      await client.query(`
        INSERT INTO public.analysis_events(analysis_id, org_id, event_type, payload)
        VALUES ($1::uuid, $2::uuid, 'error', $3::jsonb)
      `, [analysisId, orgId, JSON.stringify({ code: 'CANCELLED', message: 'Analysis cancelled', status: 'cancelled' })]);
      return true;
    });
  }

  async recoverExpired(limit: number): Promise<number> {
    return this.inTransaction(async (client) => {
      const expired = await client.query<{
        id: string;
        org_id: string;
        cancel_requested: boolean;
        has_partial: boolean;
      }>(`
        SELECT id, org_id, cancel_requested, partial_result <> '{}'::jsonb AS has_partial
          FROM public.analyses
         WHERE status = 'streaming'
           AND lease_until < now()
         ORDER BY lease_until, id
         FOR UPDATE SKIP LOCKED
         LIMIT $1
      `, [limit]);

      for (const row of expired.rows) {
        const status = row.cancel_requested ? 'cancelled' : row.has_partial ? 'partial' : 'error';
        const code = row.cancel_requested ? 'CANCELLED' : 'WORKER_INTERRUPTED';
        const message = row.cancel_requested ? 'Analysis cancelled' : 'Analysis worker stopped before completion';
        await client.query(`
          UPDATE public.analyses
             SET status = $2,
                 error_code = $3,
                 error_message = $4,
                 lease_until = NULL,
                 lease_token = NULL,
                 updated_at = now()
           WHERE id = $1::uuid
        `, [row.id, status, code, message]);
        await client.query(`
          INSERT INTO public.analysis_events(analysis_id, org_id, event_type, payload)
          VALUES ($1::uuid, $2::uuid, 'error', $3::jsonb)
        `, [row.id, row.org_id, JSON.stringify({ code, message, status })]);
      }
      return expired.rowCount ?? 0;
    });
  }

  private async finish(
    analysisId: string,
    leaseToken: string,
    work: (client: PoolClient, orgId: string) => Promise<boolean>
  ): Promise<boolean> {
    return this.inTransaction(async (client) => {
      const locked = await client.query<{ org_id: string }>(`
        SELECT org_id
          FROM public.analyses
         WHERE id = $1::uuid
           AND lease_token = $2::uuid
           AND status = 'streaming'
         FOR UPDATE
      `, [analysisId, leaseToken]);
      const row = locked.rows[0];
      return row ? work(client, row.org_id) : false;
    });
  }

  private async inTransaction<T>(work: (client: PoolClient) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const result = await work(client);
      await client.query('COMMIT');
      return result;
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }
}
