import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import test from 'node:test';
import { verifyWebhookSignature } from '../src/shared/auth/webhook-signature';
import { extractTopLevelInteger } from '../src/shared/http/extract-top-level-integer';

test('webhook HMAC validates the exact raw body', () => {
  const raw = Buffer.from('{"event_id":"e","sequence":9007199254740993}');
  const secret = 'secret';
  const signature = `sha256=${createHmac('sha256', secret).update(raw).digest('hex')}`;

  assert.equal(verifyWebhookSignature(raw, signature, secret), true);
  assert.equal(verifyWebhookSignature(Buffer.from(`${raw.toString()} `), signature, secret), false);
});

test('top-level sequence keeps bigint precision', () => {
  const raw = Buffer.from('{"data":{"sequence":1},"sequence":9007199254740993,"event_id":"e"}');
  assert.equal(extractTopLevelInteger(raw, 'sequence'), '9007199254740993');
});
