import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { sanitizeMpesaRequestPayload, sanitizeMpesaResponsePayload } from './request-logging';

test('sanitizeMpesaRequestPayload retains request fields and redacts credentials recursively', () => {
  const sanitized = sanitizeMpesaRequestPayload({
    Amount: 500,
    Password: 'generated-password',
    CallBackURL: 'https://example.test/callback?token=callback-secret',
    metadata: [{ ConsumerSecret: 'consumer-secret' }],
  });

  assert.deepEqual(sanitized, {
    Amount: 500,
    Password: '[REDACTED]',
    CallBackURL: 'https://example.test/callback?token=[REDACTED]',
    metadata: [{ ConsumerSecret: '[REDACTED]' }],
  });
});

test('sanitizeMpesaResponsePayload redacts nested access tokens and preserves diagnostic fields', () => {
  const sanitized = sanitizeMpesaResponsePayload({
    ResultCode: 2029,
    ResultDesc: 'Failed due to an unresolved reason type.',
    nested: { access_token: 'access-token-secret' },
  });

  assert.deepEqual(sanitized, {
    ResultCode: 2029,
    ResultDesc: 'Failed due to an unresolved reason type.',
    nested: { access_token: '[REDACTED]' },
  });
});
