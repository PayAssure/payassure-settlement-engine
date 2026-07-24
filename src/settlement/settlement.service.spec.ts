import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import { SettlementService } from './settlement.service';

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

test('handleFakeB2bCallback marks supplier and retailer allocations as paid', async () => {
  let updatedPayload: any = null;

  const repository = {
    findSettlementByReference: async () => ({
      id: 'settlement-3',
      status: 'PROCESSING',
      metadata: {
        allocationPlan: {
          allocations: [
            { party: 'Supplier', amount: 18000, destination: 'B2B payout', status: 'PENDING' },
            { party: 'Retailer', amount: 1600, destination: 'B2B payout', status: 'PENDING' },
          ],
        },
      },
    }),
    updateSettlementStatus: async (_id: string, _status: string, updates: any) => {
      updatedPayload = updates;
      return { id: 'settlement-3', ...updates };
    },
  };

  const service = new SettlementService(repository as any);
  await service.processFakeB2bPayout({
    reference: 'payout-1',
    settlementReference: 'settlement-3',
    merchantTransactionReference: 'TXN-3003',
    party: 'Supplier',
  } as any);

  await service.handleFakeB2bCallback({
    reference: 'payout-1',
    status: 'SUCCESS',
    providerReference: 'MPESA-777',
  } as any);

  assert.equal(updatedPayload.metadata.allocationPlan.allocations[0].status, 'PAID');
  assert.equal(updatedPayload.metadata.allocationPlan.allocations[0].paidAt, updatedPayload.metadata.payoutTrace.completedAt);
});

test('simulateLedgerPayouts creates fake B2B payout records after a successful callback', async () => {
  let updatedStatus: any = null;
  let updatedPayload: any = null;

  const repository = {
    findSettlementByReference: async () => ({
      id: 'settlement-2',
      status: 'PENDING_PROCESSING',
      amount: 20000,
      metadata: {
        paymentCallback: {
          status: 'SUCCESS',
          merchantTransactionReference: 'TXN-2002',
        },
        allocationPlan: {
          allocations: [
            { party: 'Supplier', amount: 18000, destination: 'B2B payout' },
            { party: 'Retailer', amount: 1600, destination: 'B2B payout' },
            { party: 'Platform', amount: 400, destination: 'Retained fee' },
          ],
        },
      },
      paymentPayload: {
        paymentMethod: {
          type: 'MPESA',
          provider: 'Safaricom',
        },
      },
    }),
    updateSettlementStatus: async (_id: string, status: string, updates: any) => {
      updatedStatus = status;
      updatedPayload = updates;
      return { id: 'settlement-2', status, ...updates };
    },
  };

  const service = new SettlementService(repository as any);
  const response = await service.simulateLedgerPayouts({
    merchantTransactionReference: 'TXN-2002',
    simulationStatus: 'PAID',
  } as any);

  assert.equal(response.success, true);
  assert.equal(updatedStatus, 'PROCESSING');
  assert.equal(response.simulationResult.payoutTransactions[0].status, 'PAID');
  assert.equal(response.simulationResult.payoutTransactions[1].status, 'PAID');
  assert.equal(updatedPayload.metadata.ledgerProcessing.simulationStatus, 'PAID');
});
