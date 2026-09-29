import { createHmac, timingSafeEqual } from 'node:crypto';

export function verifyWebhookSignature(rawBody: Buffer, signature: string | undefined, secret: string): boolean {
  if (!signature?.startsWith('sha256=')) return false;
  const hex = signature.slice('sha256='.length);
  if (!/^[0-9a-fA-F]{64}$/.test(hex)) return false;

  const supplied = Buffer.from(hex, 'hex');
  const expected = createHmac('sha256', secret).update(rawBody).digest();
  return supplied.length === expected.length && timingSafeEqual(supplied, expected);
}
