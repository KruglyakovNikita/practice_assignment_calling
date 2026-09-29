import { BadRequestException, Controller, HttpCode, NotFoundException, Post, Req, UseGuards } from '@nestjs/common';
import { z } from 'zod';
import { extractTopLevelInteger } from '../../../shared/http/extract-top-level-integer';
import type { requestContext } from '../../../shared/http/request-context';
import { CallNotFoundError } from '../../application/ports/call-event.port';
import { ReceiveCallEventUseCase } from '../../application/use-cases/receive-call-event.use-case';
import { callEventTypes } from '../../domain/call-event';
import { WebhookSignatureGuard } from './webhook-signature.guard';

const bodySchema = z.object({
  event_id: z.string().min(1),
  call_id: z.string().min(1),
  type: z.enum(callEventTypes),
  occurred_at: z.string().datetime({ offset: true }),
  data: z.record(z.string(), z.unknown())
}).passthrough();

const pgBigintMax = 9223372036854775807n;

@Controller('webhooks')
export class CallsWebhookController {
  constructor(private readonly receiveCallEvent: ReceiveCallEventUseCase) {}

  @Post('calls')
  @HttpCode(200)
  @UseGuards(WebhookSignatureGuard)
  async receive(@Req() req: requestContext): Promise<{ ok: true; duplicate: boolean }> {
    if (!req.rawBody) {
      throw new BadRequestException({ code: 'INVALID_REQUEST' });
    }

    const parsed = bodySchema.safeParse(req.body);
    const sequenceRaw = extractTopLevelInteger(req.rawBody, 'sequence');
    if (!parsed.success || sequenceRaw === null) {
      throw new BadRequestException({ code: 'INVALID_REQUEST' });
    }

    const sequence = BigInt(sequenceRaw);
    if (sequence < 0n || sequence > pgBigintMax) {
      throw new BadRequestException({ code: 'INVALID_SEQUENCE' });
    }

    try {
      const result = await this.receiveCallEvent.execute({
        eventId: parsed.data.event_id,
        callId: parsed.data.call_id,
        sequence,
        type: parsed.data.type,
        occurredAt: new Date(parsed.data.occurred_at),
        data: parsed.data.data,
        rawPayload: req.rawBody.toString('utf8'),
        correlationId: req.correlationId
      });
      return { ok: true, duplicate: result.duplicate };
    } catch (error) {
      if (error instanceof CallNotFoundError) {
        throw new NotFoundException({ code: 'CALL_NOT_FOUND' });
      }
      throw error;
    }
  }
}
