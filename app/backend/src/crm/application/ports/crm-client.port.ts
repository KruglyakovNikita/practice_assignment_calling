export type crmDelivery = {
  payload: Record<string, unknown>;
  correlationId: string | null;
};

export type crmDeliveryResult =
  | { ok: true }
  | { ok: false; errorCode: string };

export interface crmClientPort {
  post(delivery: crmDelivery): Promise<crmDeliveryResult>;
}

export const CRM_CLIENT_PORT = Symbol('CRM_CLIENT_PORT');
