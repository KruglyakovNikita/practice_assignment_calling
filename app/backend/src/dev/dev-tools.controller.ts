import { BadRequestException, Body, Controller, Get, HttpCode, Inject, NotFoundException, Param, Post, Put } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { signJwt } from '../shared/auth/sign-jwt';
import { signWebhookBody } from '../shared/auth/webhook-signature';
import { RUNTIME_CONFIG } from '../shared/config/config.module';
import type { runtimeConfig } from '../shared/config/runtime-config';
import { callEventTypes } from '../calls/domain/call-event';
import { DevToolsRepository } from './dev-tools.repository';

const tokenSchema = z.object({
  org_id: z.guid(),
  sub: z.string().min(1),
  role: z.enum(['worker', 'authenticated'])
});
const seedSchema = z.object({ contacts: z.number().int().min(1).max(100).default(5) });
const webhookSchema = z.object({
  call_id: z.string().min(1),
  type: z.enum(callEventTypes),
  data: z.record(z.string(), z.unknown()).default({}),
  sequence: z.number().int().min(0).optional(),
  event_id: z.string().min(1).optional()
});
const transcriptSchema = z.object({ transcript: z.string().nullable() });

function parse<T>(schema: z.ZodType<T>, body: unknown): T {
  const parsed = schema.safeParse(body ?? {});
  if (!parsed.success) throw new BadRequestException({ code: 'INVALID_REQUEST' });
  return parsed.data;
}

// Manual-testing helpers: mint tokens for any org and sign webhooks, so AppModule registers them only with DEV_TOOLS=true.
@Controller('dev')
export class DevToolsController {
  constructor(
    @Inject(RUNTIME_CONFIG) private readonly config: runtimeConfig,
    private readonly repository: DevToolsRepository
  ) {}

  // UI probe: 404 without DEV_TOOLS hides the dev blocks.
  @Get('status')
  status(): { enabled: true } {
    return { enabled: true };
  }

  @Post('token')
  @HttpCode(200)
  token(@Body() body: unknown): { token: string } {
    const input = parse(tokenSchema, body);
    return { token: signJwt({ orgId: input.org_id, sub: input.sub, role: input.role, secret: this.config.jwtSecret }) };
  }

  @Post('seed')
  @HttpCode(200)
  async seed(@Body() body: unknown): Promise<unknown> {
    const input = parse(seedSchema, body);
    const seeded = await this.repository.seed(input.contacts);
    return {
      org_id: seeded.orgId,
      campaign_id: seeded.campaignId,
      timezone: seeded.timezone,
      contacts: input.contacts,
      token: signJwt({ orgId: seeded.orgId, sub: 'demo-user', role: 'worker', secret: this.config.jwtSecret })
    };
  }

  // Plays the provider: builds the event, signs it with WEBHOOK_SECRET and sends it through the
  // real POST /webhooks/calls, so HMAC, dedup and ordering are exercised end to end.
  @Post('webhook')
  @HttpCode(200)
  async webhook(@Body() body: unknown): Promise<unknown> {
    const input = parse(webhookSchema, body);
    const event = {
      event_id: input.event_id ?? `evt_dev_${randomUUID()}`,
      call_id: input.call_id,
      sequence: input.sequence ?? await this.repository.nextSequence(input.call_id),
      type: input.type,
      occurred_at: new Date().toISOString(),
      data: input.data
    };
    const raw = JSON.stringify(event);
    const response = await fetch(`http://127.0.0.1:${this.config.port}/webhooks/calls`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-signature': signWebhookBody(raw, this.config.webhookSecret) },
      body: raw
    });
    return {
      event,
      http_status: response.status,
      correlation_id: response.headers.get('x-correlation-id'),
      response: await response.json().catch(() => null)
    };
  }

  @Put('attempts/:id/transcript')
  async transcript(@Param('id') id: string, @Body() body: unknown): Promise<{ ok: true }> {
    const input = parse(transcriptSchema, body);
    if (!z.guid().safeParse(id).success || !await this.repository.setTranscript(id, input.transcript)) {
      throw new NotFoundException({ code: 'CALL_ATTEMPT_NOT_FOUND' });
    }
    return { ok: true };
  }

  @Get('attempts/:id')
  async attempt(@Param('id') id: string): Promise<unknown> {
    const snapshot = z.guid().safeParse(id).success ? await this.repository.attemptSnapshot(id) : null;
    if (!snapshot) throw new NotFoundException({ code: 'CALL_ATTEMPT_NOT_FOUND' });
    return snapshot;
  }
}
