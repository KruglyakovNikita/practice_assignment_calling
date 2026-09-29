import { CanActivate, ExecutionContext, Inject, Injectable, UnauthorizedException } from '@nestjs/common';
import { RUNTIME_CONFIG } from '../../../shared/config/config.module';
import type { runtimeConfig } from '../../../shared/config/runtime-config';
import { verifyWebhookSignature } from '../../../shared/auth/webhook-signature';
import type { requestContext } from '../../../shared/http/request-context';

@Injectable()
export class WebhookSignatureGuard implements CanActivate {
  constructor(@Inject(RUNTIME_CONFIG) private readonly config: runtimeConfig) {}

  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest<requestContext>();
    const signature = req.header('x-signature');
    if (!req.rawBody || !verifyWebhookSignature(req.rawBody, signature, this.config.webhookSecret)) {
      throw new UnauthorizedException({ code: 'INVALID_SIGNATURE' });
    }
    return true;
  }
}
