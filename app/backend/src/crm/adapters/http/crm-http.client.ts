import { Inject, Injectable } from '@nestjs/common';
import type { runtimeConfig } from '../../../shared/config/runtime-config';
import { RUNTIME_CONFIG } from '../../../shared/config/config.module';
import type { crmClientPort, crmDelivery, crmDeliveryResult } from '../../application/ports/crm-client.port';

@Injectable()
export class CrmHttpClient implements crmClientPort {
  constructor(@Inject(RUNTIME_CONFIG) private readonly config: runtimeConfig) {}

  async post(delivery: crmDelivery): Promise<crmDeliveryResult> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.config.crmTimeoutMs);

    try {
      const response = await fetch(this.config.crmUrl, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          ...(delivery.correlationId ? { 'x-correlation-id': delivery.correlationId } : {})
        },
        body: JSON.stringify(delivery.payload),
        signal: controller.signal
      });
      if (response.ok) return { ok: true };
      return { ok: false, errorCode: `HTTP_${response.status}` };
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') {
        return { ok: false, errorCode: 'TIMEOUT' };
      }
      return { ok: false, errorCode: 'NETWORK_ERROR' };
    } finally {
      clearTimeout(timeout);
    }
  }
}
