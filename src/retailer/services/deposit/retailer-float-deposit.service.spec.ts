import { test } from 'node:test';
import assert = require('node:assert/strict');
import { prisma } from '../../../common/database/prisma';
import { retailerFloatDepositService } from './retailer-float-deposit.service';
import { retailerEscrowTransferService } from '../transfer/retailer-escrow-transfer.service';

test('retailer float deposit uses retailer STK credentials and does not update balance before callback', async () => {
  const integrationModel = (prisma as any).integration;
  const floatModel = (prisma as any).retailerEscrowFloat;
  const depositModel = (prisma as any).retailerEscrowFloatDeposit;
  const original = {
    integrationFindUnique: integrationModel.findUnique,
    floatFindUnique: floatModel.findUnique,
    depositCreate: depositModel.create,
    depositUpdate: depositModel.update,
    makeRequest: (retailerFloatDepositService as any).makeRequest,
  };
  const previous = new Map(['MPESA_RETAILER_ENVIRONMENT', 'MPESA_RETAILER_CONSUMER_KEY', 'MPESA_RETAILER_CONSUMER_SECRET', 'MPESA_RETAILER_SHORTCODE', 'MPESA_RETAILER_PASSKEY', 'MPESA_RETAILER_CALLBACK_URL'].map((name) => [name, process.env[name]]));
  let floatUpdated = false;
  let createdDeposit: any;

  try {
    process.env.MPESA_RETAILER_ENVIRONMENT = 'sandbox';
    process.env.MPESA_RETAILER_CONSUMER_KEY = 'retailer-key';
    process.env.MPESA_RETAILER_CONSUMER_SECRET = 'retailer-secret';
    process.env.MPESA_RETAILER_SHORTCODE = '600001';
    process.env.MPESA_RETAILER_PASSKEY = 'retailer-passkey';
    process.env.MPESA_RETAILER_CALLBACK_URL = 'https://example.test/payments';
    integrationModel.findUnique = async () => ({ isActive: true, participant: { participantType: 'RETAILER', status: 'ACTIVE' } });
    floatModel.findUnique = async () => ({ id: 'float-1' });
    depositModel.create = async ({ data }: any) => {
      createdDeposit = { id: 'deposit-1', ...data };
      return createdDeposit;
    };
    depositModel.update = async ({ data }: any) => data;
    floatModel.update = async () => { floatUpdated = true; return {}; };
    let payload: any;
    let credentials: any;
    (retailerFloatDepositService as any).makeRequest = async (_endpoint: string, nextPayload: any, nextCredentials: any) => {
      payload = nextPayload;
      credentials = nextCredentials;
      return { ResponseCode: '0', MerchantRequestID: 'merchant-request-1', CheckoutRequestID: 'checkout-1' };
    };

    const result = await retailerFloatDepositService.initiate('pay_retailer_001', 5000, '0700000000');

    assert.equal(result.status, 'SUBMITTED');
    assert.equal(payload.BusinessShortCode, '600001');
    assert.equal(payload.PartyB, '600001');
    const callbackUrl = new URL(payload.CallBackURL);
    assert.match(callbackUrl.pathname, /retailer-float-deposit\/deposit-1$/);
    assert.equal(callbackUrl.searchParams.get('token'), createdDeposit.callbackToken);
    assert.equal(credentials.consumerKey, 'retailer-key');
    assert.equal(credentials.consumerSecret, 'retailer-secret');
    assert.equal(credentials.environment, 'sandbox');
    assert.equal(floatUpdated, false);
  } finally {
    integrationModel.findUnique = original.integrationFindUnique;
    floatModel.findUnique = original.floatFindUnique;
    depositModel.create = original.depositCreate;
    depositModel.update = original.depositUpdate;
    (retailerFloatDepositService as any).makeRequest = original.makeRequest;
    for (const [name, value] of previous) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  }
});

test('successful float deposit callback marks the deposit successful once and ignores duplicates', async () => {
  const depositModel = (prisma as any).retailerEscrowFloatDeposit;
  const originalTransaction = (prisma as any).$transaction;
  const original = {
    depositFindUnique: depositModel.findUnique,
    depositUpdateMany: depositModel.updateMany,
    depositFindUniqueOrThrow: depositModel.findUniqueOrThrow,
  };
  const deposit: any = {
    id: 'deposit-2',
    retailerEscrowFloatId: 'float-2',
    retailerMerchantId: 'pay_retailer_002',
    retailerEscrowFloat: { merchantId: 'pay_retailer_002' },
    amount: 5000,
    callbackToken: 'deposit-token-2',
    status: 'SUBMITTED',
  };
  try {
    depositModel.findUnique = async () => deposit;
    depositModel.updateMany = async ({ data }: any) => {
      if (deposit.status !== 'SUBMITTED') return { count: 0 };
      Object.assign(deposit, data);
      return { count: 1 };
    };
    depositModel.findUniqueOrThrow = async () => ({ status: deposit.status });
    (prisma as any).$transaction = async (callback: (tx: any) => Promise<unknown>) => callback(prisma);
    const callback = { Body: { stkCallback: { ResultCode: 0, ResultDesc: 'Success', CallbackMetadata: { Item: [{ Name: 'Amount', Value: 5000 }, { Name: 'MpesaReceiptNumber', Value: 'ABC123' }] } } } };

    const first = await retailerFloatDepositService.handleCallback('deposit-2', callback, 'deposit-token-2');
    const duplicate = await retailerFloatDepositService.handleCallback('deposit-2', callback, 'deposit-token-2');

    assert.equal(first.status, 'SUCCEEDED');
    assert.equal(duplicate.duplicate, true);
    assert.equal(deposit.status, 'SUCCEEDED');
  } finally {
    (prisma as any).$transaction = originalTransaction;
    depositModel.findUnique = original.depositFindUnique;
    depositModel.updateMany = original.depositUpdateMany;
    depositModel.findUniqueOrThrow = original.depositFindUniqueOrThrow;
  }
});

test('float deposit callback without confirmed amount metadata does not credit a deposit', async () => {
  const depositModel = (prisma as any).retailerEscrowFloatDeposit;
  const original = {
    findUnique: depositModel.findUnique,
    update: depositModel.update,
  };
  let update: any;

  try {
    depositModel.findUnique = async () => ({
      id: 'deposit-missing-amount',
      amount: 5000,
      retailerMerchantId: 'pay_retailer_001',
      retailerEscrowFloat: { merchantId: 'pay_retailer_001' },
      callbackToken: 'deposit-token-missing-amount',
      status: 'SUBMITTED',
    });
    depositModel.update = async ({ data }: any) => { update = data; return data; };

    const result = await retailerFloatDepositService.handleCallback('deposit-missing-amount', {
      Body: { stkCallback: { ResultCode: 0, ResultDesc: 'Success' } },
    }, 'deposit-token-missing-amount');

    assert.equal(result.status, 'FAILED');
    assert.equal(update.status, 'FAILED');
    assert.match(update.failureReason, /received missing/);
  } finally {
    depositModel.findUnique = original.findUnique;
    depositModel.update = original.update;
  }
});

test('float deposit callback cannot credit another retailer float', async () => {
  const depositModel = (prisma as any).retailerEscrowFloatDeposit;
  const original = depositModel.findUnique;
  depositModel.findUnique = async () => ({
    id: 'deposit-owner-mismatch',
    retailerMerchantId: 'pay_retailer_one',
    retailerEscrowFloat: { merchantId: 'pay_retailer_two' },
    callbackToken: 'valid-token',
    status: 'SUBMITTED',
  });

  try {
    await assert.rejects(
      () => retailerFloatDepositService.handleCallback('deposit-owner-mismatch', {}, 'valid-token'),
      (error: any) => error.status === 409,
    );
  } finally {
    depositModel.findUnique = original;
  }
});

test('float deposit callback with an invalid token cannot change deposit status', async () => {
  const depositModel = (prisma as any).retailerEscrowFloatDeposit;
  const original = depositModel.findUnique;
  depositModel.findUnique = async () => ({ id: 'deposit-invalid-token', callbackToken: 'correct-token', status: 'SUBMITTED' });

  try {
    await assert.rejects(
      () => retailerFloatDepositService.handleCallback('deposit-invalid-token', {}, 'wrong-token'),
      (error: any) => error.status === 401,
    );
  } finally {
    depositModel.findUnique = original;
  }
});

test('retailer float access resolves the merchant from the logged-in user', async () => {
  const integrationModel = (prisma as any).integration;
  const original = {
    integrationFindFirst: integrationModel.findFirst,
  };

  try {
    integrationModel.findFirst = async ({ where }: any) => where.participant.email === 'retailer@example.com'
      ? { merchantId: 'pay_retailer_001', participant: { participantType: 'RETAILER', status: 'ACTIVE', email: 'retailer@example.com' } }
      : null;

    const merchantId = await retailerEscrowTransferService.getAuthenticatedRetailerMerchantId({ email: 'retailer@example.com' });
    assert.equal(merchantId, 'pay_retailer_001');
    await assert.rejects(
      () => retailerEscrowTransferService.getAuthenticatedRetailerMerchantId({ email: 'other@example.com' }),
      (error: any) => error.response?.error === 'RETAILER_USER_MISMATCH',
    );
  } finally {
    integrationModel.findFirst = original.integrationFindFirst;
  }
});