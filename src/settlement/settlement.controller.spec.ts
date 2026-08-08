import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import * as crypto from 'crypto';
import { PATH_METADATA } from '@nestjs/common/constants';
import { SettlementController } from './settlement.controller';
import { createSettlementConfirmationSignature } from './helpers/settlement-confirmation-credentials';

test('payment confirmation endpoint is exposed at settlements/payment-confirmation', () => {
  const path = Reflect.getMetadata(PATH_METADATA, SettlementController.prototype.confirmSettlementPayment);
  const normalizedPath = Array.isArray(path) ? path[0] : path;

  assert.equal(normalizedPath, 'payment-confirmation');
});

test('signature helper derives the signature from the configured secret without using the request body', () => {
  const secret = 'shared-secret';
  const expected = crypto.createHmac('sha256', secret).update('').digest('hex');

  assert.equal(createSettlementConfirmationSignature(secret), expected);
});

test('logs the presented signature and authentication method when signature validation fails', async () => {
  const controller = new SettlementController({ confirmSettlementPayment: async () => ({}) } as any);
  const warnings: string[] = [];
  (controller as any).logger = {
    log: () => undefined,
    warn: (message: string) => warnings.push(message),
  };

  process.env.PAYMENT_GATEWAY_API_TOKEN = 'gateway-token';
  process.env.PAYMENT_GATEWAY_SIGNATURE_SECRET = 'gateway-secret';

  await assert.rejects(
    () =>
      controller.confirmSettlementPayment(
        { settlementId: 'SETT-1', paymentId: 'PAY-1' } as any,
        {
          authorization: 'Bearer gateway-token',
          'x-payassure-signature': 'bad-signature',
          'x-payassure-timestamp': '1784962913',
        } as any,
      ),
    (error: any) => {
      assert.equal(error.response.message, 'Invalid signature');
      assert.equal(warnings.length, 1);
      assert.match(warnings[0], /presentedSignature=bad-signature/);
      assert.match(warnings[0], /authentication=Bearer/);
      return true;
    },
  );
});
