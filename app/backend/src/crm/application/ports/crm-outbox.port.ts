export type leasedCrmMessage = {
  id: string;
  leaseToken: string;
  attempts: number;
  payload: Record<string, unknown>;
  correlationId: string | null;
};

export interface crmOutboxPort {
  leaseBatch(limit: number, leaseMs: number): Promise<leasedCrmMessage[]>;
  markDelivered(id: string, leaseToken: string): Promise<void>;
  markFailed(input: {
    id: string;
    leaseToken: string;
    errorCode: string;
    retryAt: Date;
    dead: boolean;
  }): Promise<void>;
}

export const CRM_OUTBOX_PORT = Symbol('CRM_OUTBOX_PORT');
