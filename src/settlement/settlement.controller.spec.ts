import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import * as crypto from 'crypto';
import { PATH_METADATA } from '@nestjs/common/constants';
import { EventEmitter } from 'node:events';
import { SettlementController } from './settlement.controller';
import { createSettlementConfirmationSignature } from './helpers/settlement-confirmation-credentials';

test('payment confirmation endpoint is exposed at settlements/payment-confirmation', () => {
  const path = Reflect.getMetadata(PATH_METADATA, SettlementController.prototype.confirmSettlementPayment);
  const normalizedPath = Array.isArray(path) ? path[0] : path;

  assert.equal(normalizedPath, 'payment-confirmation');
});

test('logs and returns the settlement initiation response unchanged', async () => {
  const expectedResponse = {
    success: true,
    settlement: { settlementId: 'settlement-1', status: 'PROCESSING' },
  };
  const controller = new SettlementController({
    initiateSettlement: async () => expectedResponse,
  } as any);
  const logged: unknown[][] = [];
  (controller as any).logger = {
    log: (...args: unknown[]) => logged.push(args),
  };
  const request = { merchantTransactionReference: 'ORDER-1' };

  const response = await controller.initiateSettlement(request as any, 'session-token');

  assert.equal(response, expectedResponse);
  assert.equal(logged[0][0], `[SETTLEMENT_REQUEST_PAYLOAD] ${JSON.stringify(request, null, 2)}`);
  assert.deepEqual(logged[1], ['[SETTLEMENT_INITIATION_RESPONSE]', expectedResponse]);
});

test('returns HTTP 201 after settlement creation while processing continues', async () => {
  const acceptedResponse = {
    success: true,
    settlement: { settlementId: 'settlement-accepted', status: 'INITIATED' },
    message: 'Settlement created; processing will continue asynchronously.',
  };
  let releaseProcessing!: () => void;
  const processingGate = new Promise<void>((resolve) => {
    releaseProcessing = resolve;
  });
  let processingCompleted = false;
  const controller = new SettlementController({
    initiateSettlement: async (_token: string, _request: unknown, onAccepted: Function) => {
      await onAccepted(acceptedResponse, 201);
      await processingGate;
      processingCompleted = true;
      return { success: true, settlement: { settlementId: 'settlement-accepted', status: 'COMPLETED' } };
    },
  } as any);
  const logged: unknown[][] = [];
  (controller as any).logger = {
    log: (...args: unknown[]) => logged.push(args),
    error: () => undefined,
  };
  let statusCode: number | undefined;
  let responseBody: unknown;
  const responseEvents = new EventEmitter();
  const response = Object.assign(responseEvents, {
    status(status: number) {
      statusCode = status;
      return this;
    },
    json(body: unknown) {
      responseBody = body;
      setImmediate(() => responseEvents.emit('finish'));
      return this;
    },
  });

  await controller.initiateSettlement(
    { merchantTransactionReference: 'ORDER-ASYNC' } as any,
    'session-token',
    response as any,
  );

  assert.equal(statusCode, 201);
  assert.equal(responseBody, acceptedResponse);
  assert.equal(processingCompleted, false);
  assert.deepEqual(logged[1], [
    '[SETTLEMENT_INITIATION_RESPONSE]',
    { statusCode: 201, body: acceptedResponse },
  ]);
  releaseProcessing();
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
