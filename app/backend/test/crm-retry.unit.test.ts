import assert from 'node:assert/strict';
import test from 'node:test';
import { retryDelayMs } from '../src/crm/application/use-cases/retry-delay';

test('CRM retry backoff is bounded', () => {
  assert.equal(retryDelayMs(0, 1000, 60000), 1000);
  assert.equal(retryDelayMs(3, 1000, 60000), 8000);
  assert.equal(retryDelayMs(20, 1000, 60000), 60000);
});
