import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import { SettlementService } from './settlement.service';
import { paymentRecordService } from '../payment/services/payment-record.service';
import { prisma } from '../payment/config/mpesa.env';

test('splitAndAllocateFunds persists payment callback metadata before B2B payout dispatch', async () => {
  let updatedStatus: any = null;
  let updatedMetadata: any = null;

  const repository = {
    findSettlementByReference: async () => ({
      id: 'settlement-split-1',
      status: 'INITIATED',
      metadata: {},
      paymentSnapshot: { type: 'BANK', shortcode: '12345', accountName: 'ACCT NAME' },
      processedAt: null,
      amount: '2',
      businessId: 'retailer-1',
      currency: 'KES',
      reference: 'REF-SPLIT-1',
      paymentPayload: {
        merchantTransactionReference: 'TXN-SPLIT-1',
        paymentMethod: {
          type: 'MPESA',
          provider: 'Safaricom',
          payerPhoneNumber: '+254700000003',
        },
        suppliers: [{ supplierMerchantId: 'SUP-3001', supplierTotalAmount: 1, retailerTotalAmount: 1, platformFee: 0 }],
      },
    }),
    updateSettlementStatus: async (_id: string, status: string, updates: any) => {
      updatedStatus = status;
      updatedMetadata = updates.metadata;
      return { id: 'settlement-split-1', status, ...updates };
    },
  };

  const service = new SettlementService(repository as any);
  let dispatchCalled = false;
  (service as any).dispatchB2bPayouts = async () => {
    dispatchCalled = true;
    if (!updatedMetadata?.paymentCallback?.status || updatedMetadata.paymentCallback.status !== 'SUCCESS') {
      throw new Error('payment callback metadata missing before B2B dispatch');
    }
    return { success: true, status: 'DISPATCHED', payoutReference: 'payout-3001' };
  };

  const response = await service.splitAndAllocateFunds({
    merchantTransactionReference: 'TXN-SPLIT-1',
    mpesaReceipt: 'RCP-3001',
    mpesaCheckoutRequestId: 'checkout-3001',
    mpesaMerchantRequestId: 'merchant-3001',
    resultCode: 0,
    resultDesc: 'The service request is processed successfully.',
  } as any);

  assert.equal(response.success, true);
  assert.equal(dispatchCalled, true);
  assert.equal(updatedMetadata.paymentCallback.status, 'SUCCESS');
  assert.equal(updatedMetadata.paymentCallback.providerReference, 'RCP-3001');
});

test('handlePaymentCallback transitions a settlement into pending processing', async () => {
  let updatedStatus: any = null;
  let updatedPayload: any = null;

  const repository = {
    findSettlementByReference: async () => ({
      id: 'settlement-1',
      status: 'INITIATED',
      metadata: {},
      paymentSnapshot: null,
      processedAt: null,
      amount: 10000,
      paymentPayload: {
        paymentMethod: {
          type: 'MPESA',
          provider: 'Safaricom',
          payerPhoneNumber: '+254700000000',
        },
      },
    }),
    updateSettlementStatus: async (_id: string, status: string, updates: any) => {
      updatedStatus = status;
      updatedPayload = updates;
      return { id: 'settlement-1', status, ...updates };
    },
  };

  const service = new SettlementService(repository as any);
  const response = await service.handlePaymentCallback({
    merchantTransactionReference: 'TXN-1001',
    status: 'SUCCESS',
    provider: 'M-PESA',
    providerReference: 'MPESA-123',
    amount: 16500,
    currency: 'KES',
  } as any);

  assert.equal(response.success, true);
  assert.equal(response.status, 'PENDING_PROCESSING');
  assert.equal(updatedStatus, 'PENDING_PROCESSING');
  assert.equal(updatedPayload.metadata.paymentCallback.merchantTransactionReference, 'TXN-1001');
  assert.equal(response.allocationPlan.allocations[0].party, 'Supplier');
  assert.equal(response.allocationPlan.paymentDetails.supplier.provider, 'Safaricom');
});

test('confirmSettlementPayment records a customer payment confirmation and marks the settlement as pending processing', async () => {
  let updatedStatus: any = null;
  let updatedPayload: any = null;

  const repository = {
    findSettlementById: async () => ({
      id: 'settlement-4',
      status: 'INITIATED',
      amount: 2000,
      metadata: {},
      paymentSnapshot: null,
      processedAt: null,
      paymentPayload: {
        paymentMethod: {
          type: 'MPESA',
          provider: 'Safaricom',
          payerPhoneNumber: '+254700000001',
        },
      },
    }),
    updateSettlementStatus: async (_id: string, status: string, updates: any) => {
      updatedStatus = status;
      updatedPayload = updates;
      return { id: 'settlement-4', status, ...updates };
    },
  };

  const service = new SettlementService(repository as any);
  const response = await service.confirmSettlementPayment({
    settlementId: 'settlement-4',
    paymentId: 'pay-001',
    status: 'PAID',
    provider: 'MPESA',
    paidAmount: 2000,
    paidAt: '2026-07-24T10:00:00.000Z',
    providerReference: {
      checkoutRequestId: 'checkout-001',
      merchantRequestId: 'merchant-001',
      receiptNumber: 'RCPT-001',
    },
  } as any);

  assert.equal(response.success, true);
  assert.equal(response.status, 'PENDING_PROCESSING');
  assert.equal(updatedStatus, 'PENDING_PROCESSING');
  assert.equal(updatedPayload.metadata.paymentConfirmation.status, 'PAID');
  assert.equal(updatedPayload.metadata.paymentConfirmation.providerReference.receiptNumber, 'RCPT-001');
  assert.equal(response.allocationPlan.allocations[0].party, 'Supplier');
});

test('confirmSettlementPayment accepts a paid confirmation payload', async () => {
  const repository = {
    findSettlementById: async () => ({
      id: 'settlement-5',
      status: 'INITIATED',
      amount: 2000,
      metadata: {},
      paymentPayload: {
        paymentMethod: {
          type: 'MPESA',
          provider: 'Safaricom',
          payerPhoneNumber: '+254700000002',
        },
      },
    }),
    updateSettlementStatus: async () => ({ id: 'settlement-5' }),
  };

  const service = new SettlementService(repository as any);

  const response = await service.confirmSettlementPayment({
    settlementId: 'settlement-5',
    paymentId: 'pay-002',
    status: 'PAID',
    provider: 'MPESA',
    paidAmount: 2000,
    paidAt: '2026-07-24T10:10:00.000Z',
  } as any);

  assert.equal(response.success, true);
  assert.equal(response.status, 'PENDING_PROCESSING');
});

test('PaymentRecordService resolves the merchant reference from the saved callback lookup when the gateway payload is missing it', async () => {
  const originalFindFirst = prisma.mpesaTransaction.findFirst as any;
  const originalUpdate = prisma.mpesaTransaction.update as any;

  const callbackLookup = 'cb-lookup-123';
  let updatedRecord: any = null;

  (prisma.mpesaTransaction as any).findFirst = async () => ({
    id: 'txn-123',
    checkoutRequestId: 'ws_CO_123',
    merchantRequestId: 'merchant-123',
    callbackToken: callbackLookup,
    merchantTransactionReference: 'TXN-LOOKUP-REF',
    processingLogs: [],
  });

  (prisma.mpesaTransaction as any).update = async ({ where, data }: any) => {
    updatedRecord = { id: where.id, ...data };
    return updatedRecord;
  };

  try {
    const result = await paymentRecordService.upsertFromMpesaCallback({
      Body: {
        stkCallback: {
          MerchantRequestID: 'merchant-123',
          CheckoutRequestID: 'ws_CO_123',
          ResultCode: 0,
          ResultDesc: 'The service request is processed successfully.',
          CallbackMetadata: {
            Item: [
              { Name: 'Amount', Value: 200 },
              { Name: 'MpesaReceiptNumber', Value: 'RCPT-123' },
              { Name: 'TransactionDate', Value: 20260815154456 },
              { Name: 'PhoneNumber', Value: 254700000000 },
            ],
          },
        },
      },
    } as any, callbackLookup);

    assert.equal(result?.status, 'COMPLETED');
    assert.equal(updatedRecord.merchantTransactionReference, 'TXN-LOOKUP-REF');
    assert.equal(updatedRecord.processingLogs.at(-1), 'callback validated and transaction completed');
  } finally {
    (prisma.mpesaTransaction as any).findFirst = originalFindFirst;
    (prisma.mpesaTransaction as any).update = originalUpdate;
  }
});

test('dispatchB2bPayouts records a dispatch and updates settlement metadata', async () => {
  let updatedStatus: any = null;
  let updatedPayload: any = null;

  const repository = {
    findSettlementByReference: async () => ({
      id: 'settlement-10',
      merchantTransactionReference: 'TXN-DISPATCH-1',
      reference: 'REF-10',
      currency: 'KES',
      metadata: {
        paymentCallback: { status: 'SUCCESS', merchantTransactionReference: 'TXN-DISPATCH-1' },
      },
      paymentSnapshot: { type: 'BANK', shortcode: '12345', accountName: 'ACCT NAME' },
    }),
    updateSettlementStatus: async (_id: string, status: string, updates: any) => {
      updatedStatus = status;
      updatedPayload = updates;
      return { id: 'settlement-10', status, ...updates };
    },
  };

  const service = new SettlementService(repository as any);
  // stub external gateway call to avoid network in unit test
  (service as any).sendB2bGatewayPayoutRequest = async () => ({ success: true, statusCode: 200, response: { gatewayId: 'gw-1' } });

  const response = await service.dispatchB2bPayouts({
    merchantTransactionReference: 'TXN-DISPATCH-1',
    party: 'SUPPLIER',
    supplierMerchantId: 'SUP-1001',
    amount: 1000,
  } as any);

  assert.equal(response.success, true);
  assert.equal(response.status, 'DISPATCHED');
  assert.equal(updatedStatus, 'PROCESSING');
  assert.equal(updatedPayload.metadata.payoutDispatches.length, 1);
});

test('dispatchB2bPayouts falls back to supplier merchant ID from payment payload metadata', async () => {
  let updatedPayload: any = null;

  const repository = {
    findSettlementByReference: async () => ({
      id: 'settlement-12',
      merchantTransactionReference: 'TXN-DISPATCH-2',
      reference: 'REF-12',
      currency: 'KES',
      metadata: {
        paymentCallback: { status: 'SUCCESS', merchantTransactionReference: 'TXN-DISPATCH-2' },
      },
      paymentSnapshot: { type: 'BANK', shortcode: '12345', accountName: 'ACCT NAME' },
      paymentPayload: {
        suppliers: [{ supplierMerchantId: 'SUP-2001' }],
      },
    }),
    updateSettlementStatus: async (_id: string, status: string, updates: any) => {
      updatedPayload = updates;
      return { id: 'settlement-12', status, ...updates };
    },
  };

  const service = new SettlementService(repository as any);
  (service as any).sendB2bGatewayPayoutRequest = async () => ({ success: true, statusCode: 200, response: { gatewayId: 'gw-2' } });

  await service.dispatchB2bPayouts({
    merchantTransactionReference: 'TXN-DISPATCH-2',
    party: 'SUPPLIER',
    amount: 1000,
  } as any);

  assert.equal(updatedPayload.metadata.payoutDispatches[0].requestPayload.metadata.supplierMerchantId, 'SUP-2001');
});

test('handleB2bPayoutCallback updates allocation status and records callback', async () => {
  let updatedStatus: any = null;
  let updatedPayload: any = null;

  const repository = {
    findSettlementByReference: async () => ({
      id: 'settlement-11',
      merchantTransactionReference: 'TXN-CALLBACK-1',
      reference: 'REF-11',
      metadata: {
        allocationPlan: {
          allocations: [
            { party: 'SUPPLIER', amount: 18000, destination: 'B2B payout', status: 'PENDING' },
            { party: 'RETAILER', amount: 1600, destination: 'B2B payout', status: 'PENDING' },
          ],
        },
      },
    }),
    updateSettlementStatus: async (_id: string, status: string, updates: any) => {
      updatedStatus = status;
      updatedPayload = updates;
      return { id: 'settlement-11', status, ...updates };
    },
  };

  const service = new SettlementService(repository as any);
  const response = await service.handleB2bPayoutCallback({
    merchantTransactionReference: 'TXN-CALLBACK-1',
    reference: 'payout-abc',
    party: 'SUPPLIER',
    status: 'SUCCESS',
    providerReference: 'GW-123',
  } as any);

  assert.equal(response.success, true);
  assert.equal(updatedStatus, 'PROCESSING');
  assert.equal(updatedPayload.metadata.allocationPlan.allocations[0].status, 'PAID');
  assert.equal(updatedPayload.metadata.payoutCallbacks.length, 1);
});
