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
});
