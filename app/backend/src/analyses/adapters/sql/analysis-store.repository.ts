import { Inject, Injectable } from '@nestjs/common';
import {
  analysisPartialResultSchema,
  analysisResultSchema,
  analysisStatusSchema,
  type analysisPartialResult,
  type analysisResult,
  type analysisStatus
} from '@auto-calling/contracts';
import type { Pool, PoolClient } from 'pg';
import { APP_DB_POOL } from '../../../shared/database/tokens';
import type {
  analysisJournalEvent,
  analysisState,
  analysisStorePort,
  createAnalysisResult,
  tenantContext
} from '../../application/ports/analysis-store.port';

@Injectable()
export class AnalysisStoreRepository implements analysisStorePort {
  constructor(@Inject(APP_DB_POOL) private readonly pool: Pool) {}

  async createOrGet(context: tenantContext, callAttemptId: string): Promise<createAnalysisResult> {
    return this.inTenantTransaction(context, async (client) => {
      const attempt = await client.query<{ status: string }>(
        'SELECT status FROM public.call_attempts WHERE id = $1::uuid',
        [callAttemptId]
      );
      const attemptRow = attempt.rows[0];
      if (!attemptRow) return { kind: 'not_found' };
      if (!['completed', 'failed', 'no_answer'].includes(attemptRow.status)) return { kind: 'not_ready' };

      const inserted = await client.query<analysisRow>(`
        INSERT INTO public.analyses(org_id, call_attempt_id)
        SELECT org_id, id
          FROM public.call_attempts
         WHERE id = $1::uuid
        ON CONFLICT (call_attempt_id) DO NOTHING
        RETURNING ${analysisColumns}
      `, [callAttemptId]);

      if (inserted.rows[0]) {
        return { kind: 'created', analysis: mapAnalysis(inserted.rows[0]) };
      }

      const existing = await client.query<analysisRow>(`
        SELECT ${analysisColumns}
          FROM public.analyses
         WHERE call_attempt_id = $1::uuid
      `, [callAttemptId]);
      const row = existing.rows[0];
      return row ? { kind: 'existing', analysis: mapAnalysis(row) } : { kind: 'not_found' };
    });
  }

  async findById(context: tenantContext, analysisId: string): Promise<analysisState | null> {
    return this.inTenantTransaction(context, async (client) => {
      const result = await client.query<analysisRow>(`
        SELECT ${analysisColumns}
          FROM public.analyses
         WHERE id = $1::uuid
      `, [analysisId]);
      return result.rows[0] ? mapAnalysis(result.rows[0]) : null;
    });
  }

  async requestCancel(context: tenantContext, analysisId: string): Promise<analysisState | null> {
    return this.inTenantTransaction(context, async (client) => {
      const current = await client.query<analysisRow>(`
        SELECT ${analysisColumns}
          FROM public.analyses
         WHERE id = $1::uuid
         FOR UPDATE
      `, [analysisId]);
      const row = current.rows[0];
      if (!row) return null;

      const status = analysisStatusSchema.parse(row.status);
      if (['completed', 'partial', 'error', 'cancelled'].includes(status)) return mapAnalysis(row);

      if (status === 'queued') {
        const updated = await client.query<analysisRow>(`
          UPDATE public.analyses
             SET status = 'cancelled',
                 cancel_requested = true,
                 error_code = 'CANCELLED',
                 error_message = 'Analysis cancelled',
                 updated_at = now()
           WHERE id = $1::uuid
          RETURNING ${analysisColumns}
        `, [analysisId]);
        await client.query(`
          INSERT INTO public.analysis_events(analysis_id, org_id, event_type, payload)
          VALUES ($1::uuid, $2::uuid, 'error', $3::jsonb)
        `, [analysisId, row.org_id, JSON.stringify({ code: 'CANCELLED', message: 'Analysis cancelled', status: 'cancelled' })]);
        return mapAnalysis(updated.rows[0]!);
      }

      const updated = await client.query<analysisRow>(`
        UPDATE public.analyses
           SET cancel_requested = true,
               updated_at = now()
         WHERE id = $1::uuid
        RETURNING ${analysisColumns}
      `, [analysisId]);
      return mapAnalysis(updated.rows[0]!);
    });
  }

  async listEventsAfter(
    context: tenantContext,
    analysisId: string,
    afterId: string,
    limit: number
  ): Promise<analysisJournalEvent[]> {
    return this.inTenantTransaction(context, async (client) => {
      const result = await client.query<{
        id: string;
        event_type: 'chunk' | 'done' | 'error';
        payload: unknown;
      }>(`
        SELECT id::text, event_type, payload
          FROM public.analysis_events
         WHERE analysis_id = $1::uuid
           AND id > $2::bigint
         ORDER BY id
         LIMIT $3
      `, [analysisId, afterId, limit]);

      return result.rows.map((event) => ({
        id: event.id,
        type: event.event_type,
        payload: isRecord(event.payload) ? event.payload : {}
      }));
    });
  }

  private async inTenantTransaction<T>(context: tenantContext, work: (client: PoolClient) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(`SELECT set_config('app.jwt', $1, true)`, [context.tenantToken]);
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

type analysisRow = {
  id: string;
  org_id: string;
  call_attempt_id: string;
  status: string;
  partial_result: unknown;
  result: unknown;
  error_code: string | null;
  error_message: string | null;
  cancel_requested: boolean;
  created_at: Date;
  updated_at: Date;
};

const analysisColumns = `
  id, org_id, call_attempt_id, status, partial_result, result,
  error_code, error_message, cancel_requested, created_at, updated_at
`;

function mapAnalysis(row: analysisRow): analysisState {
  return {
    id: row.id,
    callAttemptId: row.call_attempt_id,
    status: analysisStatusSchema.parse(row.status) as analysisStatus,
    partialResult: analysisPartialResultSchema.parse(row.partial_result) as analysisPartialResult,
    result: row.result === null ? null : analysisResultSchema.parse(row.result) as analysisResult,
    errorCode: row.error_code,
    errorMessage: row.error_message,
    cancelRequested: row.cancel_requested,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
