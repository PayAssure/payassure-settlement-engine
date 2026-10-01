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

  try {
    process.env.MPESA_RETAILER_ENVIRONMENT = 'sandbox';
    process.env.MPESA_RETAILER_CONSUMER_KEY = 'retailer-key';
    process.env.MPESA_RETAILER_CONSUMER_SECRET = 'retailer-secret';
    process.env.MPESA_RETAILER_SHORTCODE = '600001';
    process.env.MPESA_RETAILER_PASSKEY = 'retailer-passkey';
    process.env.MPESA_RETAILER_CALLBACK_URL = 'https://example.test/payments';
    integrationModel.findUnique = async () => ({ participant: { participantType: 'RETAILER' } });
    floatModel.findUnique = async () => ({ id: 'float-1' });
    depositModel.create = async ({ data }: any) => ({ id: 'deposit-1', ...data });
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
    assert.match(payload.CallBackURL, /retailer-float-deposit\/deposit-1$/);
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

test('successful float deposit callback increments balance once and duplicate callback is ignored', async () => {
  const depositModel = (prisma as any).retailerEscrowFloatDeposit;
  const floatModel = (prisma as any).retailerEscrowFloat;
  const originalTransaction = (prisma as any).$transaction;
  const original = {
    depositFindUnique: depositModel.findUnique,
    depositUpdateMany: depositModel.updateMany,
    depositFindUniqueOrThrow: depositModel.findUniqueOrThrow,
    floatUpdate: floatModel.update,
  };
  const deposit: any = {
    id: 'deposit-2',
    retailerEscrowFloatId: 'float-2',
    amount: 5000,
    status: 'SUBMITTED',
  };
  let increments = 0;

  try {
    depositModel.findUnique = async () => deposit;
    depositModel.updateMany = async ({ data }: any) => {
      if (deposit.status !== 'SUBMITTED') return { count: 0 };
      Object.assign(deposit, data);
      return { count: 1 };
    };
    depositModel.findUniqueOrThrow = async () => ({ status: deposit.status });
    floatModel.update = async ({ data }: any) => {
      increments += Number(data.expectedRemainingBalance.increment);
      return {};
    };
    (prisma as any).$transaction = async (callback: (tx: any) => Promise<unknown>) => callback(prisma);
    const callback = { Body: { stkCallback: { ResultCode: 0, ResultDesc: 'Success', CallbackMetadata: { Item: [{ Name: 'Amount', Value: 5000 }, { Name: 'MpesaReceiptNumber', Value: 'ABC123' }] } } } };

    const first = await retailerFloatDepositService.handleCallback('deposit-2', callback);
    const duplicate = await retailerFloatDepositService.handleCallback('deposit-2', callback);

    assert.equal(first.status, 'SUCCEEDED');
    assert.equal(duplicate.duplicate, true);
    assert.equal(increments, 5000);
  } finally {
    (prisma as any).$transaction = originalTransaction;
    depositModel.findUnique = original.depositFindUnique;
    depositModel.updateMany = original.depositUpdateMany;
    depositModel.findUniqueOrThrow = original.depositFindUniqueOrThrow;
    floatModel.update = original.floatUpdate;
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