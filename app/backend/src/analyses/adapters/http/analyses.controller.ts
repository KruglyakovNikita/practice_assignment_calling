import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  Get,
  Header,
  Headers,
  HttpCode,
  NotFoundException,
  Param,
  Post,
  Req,
  Sse,
  UseGuards,
  type MessageEvent,
  type OnModuleDestroy
} from '@nestjs/common';
import { z } from 'zod';
import { Observable } from 'rxjs';
import { JwtAuthGuard } from '../../../shared/auth/jwt-auth.guard';
import type { requestContext } from '../../../shared/http/request-context';
import {
  AnalysisNotFoundError,
  CallAttemptNotFoundError,
  CallAttemptNotReadyError
} from '../../application/analysis-errors';
import { CancelAnalysisUseCase } from '../../application/use-cases/cancel-analysis.use-case';
import { CreateAnalysisUseCase } from '../../application/use-cases/create-analysis.use-case';
import { GetAnalysisUseCase } from '../../application/use-cases/get-analysis.use-case';
import { StreamAnalysisEventsUseCase } from '../../application/use-cases/stream-analysis-events.use-case';

const createSchema = z.object({ call_attempt_id: z.guid() });
const idSchema = z.guid();
const eventIdSchema = z.string().regex(/^\d+$/);

@Controller('api/analyses')
@UseGuards(JwtAuthGuard)
export class AnalysesController implements OnModuleDestroy {
  // Ends open SSE responses on shutdown so the HTTP server can drain; clients resume with Last-Event-ID.
  private readonly shutdown = new AbortController();

  constructor(
    private readonly createAnalysis: CreateAnalysisUseCase,
    private readonly getAnalysis: GetAnalysisUseCase,
    private readonly cancelAnalysis: CancelAnalysisUseCase,
    private readonly streamEvents: StreamAnalysisEventsUseCase
  ) {}

  @Post()
  @HttpCode(200)
  async create(@Body() body: unknown, @Req() req: requestContext): Promise<{ id: string; status: string }> {
    const parsed = createSchema.safeParse(body);
    const principal = req.principal;
    if (!parsed.success || !principal) throw new BadRequestException({ code: 'INVALID_REQUEST' });

    try {
      const analysis = await this.createAnalysis.execute({
        orgId: principal.orgId,
        tenantToken: principal.token,
        callAttemptId: parsed.data.call_attempt_id
      });
      return { id: analysis.id, status: analysis.status };
    } catch (error) {
      if (error instanceof CallAttemptNotFoundError) throw new NotFoundException({ code: 'CALL_ATTEMPT_NOT_FOUND' });
      if (error instanceof CallAttemptNotReadyError) throw new ConflictException({ code: 'CALL_ATTEMPT_NOT_READY' });
      throw error;
    }
  }

  @Get(':id')
  async get(@Param('id') id: string, @Req() req: requestContext): Promise<unknown> {
    const analysisId = this.parseId(id);
    const principal = req.principal;
    if (!principal) throw new BadRequestException({ code: 'INVALID_REQUEST' });

    try {
      const analysis = await this.getAnalysis.execute({
        orgId: principal.orgId,
        tenantToken: principal.token,
        analysisId
      });
      return serializeAnalysis(analysis);
    } catch (error) {
      if (error instanceof AnalysisNotFoundError) throw new NotFoundException({ code: 'ANALYSIS_NOT_FOUND' });
      throw error;
    }
  }

  @Post(':id/cancel')
  @HttpCode(200)
  async cancel(@Param('id') id: string, @Req() req: requestContext): Promise<{ id: string; status: string }> {
    const analysisId = this.parseId(id);
    const principal = req.principal;
    if (!principal) throw new BadRequestException({ code: 'INVALID_REQUEST' });

    try {
      const analysis = await this.cancelAnalysis.execute({
        orgId: principal.orgId,
        tenantToken: principal.token,
        analysisId
      });
      return { id: analysis.id, status: analysis.status };
    } catch (error) {
      if (error instanceof AnalysisNotFoundError) throw new NotFoundException({ code: 'ANALYSIS_NOT_FOUND' });
      throw error;
    }
  }

  @Sse(':id/stream')
  @Header('X-Accel-Buffering', 'no')
  async stream(
    @Param('id') id: string,
    @Headers('last-event-id') lastEventId: string | undefined,
    @Req() req: requestContext
  ): Promise<Observable<MessageEvent>> {
    const analysisId = this.parseId(id);
    const afterId = lastEventId && lastEventId.length > 0 ? lastEventId : '0';
    if (!eventIdSchema.safeParse(afterId).success) throw new BadRequestException({ code: 'INVALID_LAST_EVENT_ID' });
    const principal = req.principal;
    if (!principal) throw new BadRequestException({ code: 'INVALID_REQUEST' });

    try {
      await this.getAnalysis.execute({ orgId: principal.orgId, tenantToken: principal.token, analysisId });
    } catch (error) {
      if (error instanceof AnalysisNotFoundError) throw new NotFoundException({ code: 'ANALYSIS_NOT_FOUND' });
      throw error;
    }

    return new Observable<MessageEvent>((subscriber) => {
      const controller = new AbortController();
      void (async () => {
        try {
          for await (const event of this.streamEvents.execute({
            orgId: principal.orgId,
            tenantToken: principal.token,
            analysisId,
            afterId,
            signal: AbortSignal.any([controller.signal, this.shutdown.signal])
          })) {
            if (subscriber.closed) break;
            subscriber.next({ id: event.id, type: event.type, data: event.payload });
          }
          subscriber.complete();
        } catch (error) {
          subscriber.error(error);
        }
      })();

      return () => controller.abort();
    });
  }

  onModuleDestroy(): void {
    this.shutdown.abort();
  }

  private parseId(id: string): string {
    const parsed = idSchema.safeParse(id);
    if (!parsed.success) throw new BadRequestException({ code: 'INVALID_ID' });
    return parsed.data;
  }
}

function serializeAnalysis(analysis: Awaited<ReturnType<GetAnalysisUseCase['execute']>>): unknown {
  return {
    id: analysis.id,
    call_attempt_id: analysis.callAttemptId,
    status: analysis.status,
    partial_result: analysis.partialResult,
    result: analysis.result,
    error: analysis.errorCode ? { code: analysis.errorCode, message: analysis.errorMessage } : null,
    cancel_requested: analysis.cancelRequested,
    created_at: analysis.createdAt.toISOString(),
    updated_at: analysis.updatedAt.toISOString()
  };
}
