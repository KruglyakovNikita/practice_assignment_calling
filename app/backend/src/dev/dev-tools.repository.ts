import { Inject, Injectable, OnApplicationShutdown } from '@nestjs/common';
import { Pool } from 'pg';
import { RUNTIME_CONFIG } from '../shared/config/config.module';
import type { runtimeConfig } from '../shared/config/runtime-config';

// Dev-only data access for the manual-testing UI. Uses the postgres owner connection on purpose:
// seeding orgs/campaigns is outside the least-privilege app/service roles and must stay that way.
@Injectable()
export class DevToolsRepository implements OnApplicationShutdown {
  private readonly pool: Pool;

  constructor(@Inject(RUNTIME_CONFIG) config: runtimeConfig) {
    this.pool = new Pool({ connectionString: config.databaseDevUrl, max: 3 });
  }

  async onApplicationShutdown(): Promise<void> {
    await this.pool.end();
  }

  async seed(contacts: number): Promise<{ orgId: string; campaignId: string; timezone: string }> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      // Zone whose local time is closest to 14:00, so the contacts are claimable right now.
      const zone = await client.query<{ name: string }>(`
        SELECT name FROM app_private.timezones
         ORDER BY abs(extract(epoch FROM ((now() AT TIME ZONE name)::time - time '14:00')))
         LIMIT 1
      `);
      const timezone = zone.rows[0]!.name;
      const org = await client.query<{ id: string }>(
        `INSERT INTO public.orgs(name) VALUES ('Demo ' || to_char(now(), 'HH24:MI:SS')) RETURNING id`
      );
      const orgId = org.rows[0]!.id;
      const campaign = await client.query<{ id: string }>(
        `INSERT INTO public.campaigns(org_id, name, status) VALUES ($1, 'Demo campaign', 'active') RETURNING id`,
        [orgId]
      );
      const campaignId = campaign.rows[0]!.id;
      await client.query(`
        INSERT INTO public.contacts(org_id, campaign_id, phone_e164, timezone)
        SELECT $1, $2, '+7999' || lpad((random() * 1e7)::int::text, 7, '0'), $3
          FROM generate_series(1, $4)
      `, [orgId, campaignId, timezone, contacts]);
      await client.query('COMMIT');
      return { orgId, campaignId, timezone };
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }

  async nextSequence(callId: string): Promise<number> {
    const result = await this.pool.query<{ next: string }>(
      'SELECT COALESCE(max(sequence), 0) + 1 AS next FROM public.webhook_events WHERE provider_call_id = $1',
      [callId]
    );
    return Number(result.rows[0]!.next);
  }

  async setTranscript(attemptId: string, transcript: string | null): Promise<boolean> {
    const result = await this.pool.query('UPDATE public.call_attempts SET transcript = $2 WHERE id = $1::uuid', [attemptId, transcript]);
    return result.rowCount === 1;
  }

  async attemptSnapshot(attemptId: string): Promise<unknown | null> {
    const attempt = await this.pool.query(`
      SELECT a.id, a.provider_call_id, a.status, a.started_at, a.ended_at, a.outcome, a.transcript,
             a.last_sequence::text, a.correlation_id,
             jsonb_build_object('id', c.id, 'phone_e164', c.phone_e164, 'timezone', c.timezone,
               'attempts_count', c.attempts_count, 'last_attempt_at', c.last_attempt_at, 'do_not_call', c.do_not_call) AS contact
        FROM public.call_attempts a
        JOIN public.contacts c ON c.id = a.contact_id
       WHERE a.id = $1::uuid
    `, [attemptId]);
    const row = attempt.rows[0];
    if (!row) return null;

    const [events, crm] = await Promise.all([
      this.pool.query(`
        SELECT provider_event_id AS event_id, sequence::text, type, received_at, correlation_id
          FROM public.webhook_events WHERE provider_call_id = $1 ORDER BY received_at, sequence
      `, [row.provider_call_id]),
      this.pool.query(`
        SELECT status, attempts, last_error, next_attempt_at, delivered_at, payload
          FROM public.crm_outbox WHERE attempt_id = $1::uuid
      `, [attemptId])
    ]);
    return { attempt: row, webhook_events: events.rows, crm: crm.rows[0] ?? null };
  }
}
