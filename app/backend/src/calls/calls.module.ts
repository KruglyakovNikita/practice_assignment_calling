import { Module } from '@nestjs/common';
import { JwtAuthGuard } from '../shared/auth/jwt-auth.guard';
import { CALL_EVENT_PORT } from './application/ports/call-event.port';
import { CONTACT_CLAIM_PORT, type contactClaimPort } from './application/ports/contact-claim.port';
import { ClaimNextContactUseCase } from './application/use-cases/claim-next-contact.use-case';
import { ReceiveCallEventUseCase } from './application/use-cases/receive-call-event.use-case';
import { type callEventPort } from './application/ports/call-event.port';
import { CallsWebhookController } from './adapters/http/calls-webhook.controller';
import { ClaimController } from './adapters/http/claim.controller';
import { WebhookSignatureGuard } from './adapters/http/webhook-signature.guard';
import { CallEventRepository } from './adapters/sql/call-event.repository';
import { ContactClaimRepository } from './adapters/sql/contact-claim.repository';

@Module({
  controllers: [ClaimController, CallsWebhookController],
  providers: [
    JwtAuthGuard,
    WebhookSignatureGuard,
    ContactClaimRepository,
    CallEventRepository,
    { provide: CONTACT_CLAIM_PORT, useExisting: ContactClaimRepository },
    { provide: CALL_EVENT_PORT, useExisting: CallEventRepository },
    {
      provide: ClaimNextContactUseCase,
      inject: [CONTACT_CLAIM_PORT],
      useFactory: (port: contactClaimPort) => new ClaimNextContactUseCase(port)
    },
    {
      provide: ReceiveCallEventUseCase,
      inject: [CALL_EVENT_PORT],
      useFactory: (port: callEventPort) => new ReceiveCallEventUseCase(port)
    }
  ]
})
export class CallsModule {}
