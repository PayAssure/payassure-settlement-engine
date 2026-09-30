import { ParticipantStatus, ParticipantType } from '@prisma/client';
import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import * as customerPayment from './initiate/payment/initiate-customer-payment';
import { retailerEscrowTransferService } from '../../retailer';
import { initiateOperation } from './initiate.operation';

function makeInitiationFixture(paymentMethod: Record<string, unknown>) {
  const created: string[] = [];
  const session = {
    id: 'session-1',
    businessId: 'retailer-business',
    integrationId: 'retailer-integration',
    expiresAt: new Date(Date.now() + 60_000),
  };
  const repository = {
    findSettlementSessionByToken: async () => session,
    touchSession: async () => undefined,
    findIntegrationById: async () => ({
      id: session.integrationId,
      participantId: session.businessId,
      merchantId: 'retailer-merchant',
      participant: { participantType: ParticipantType.RETAILER, status: ParticipantStatus.ACTIVE },
    }),
    findSettlementByBusinessAndPayloadReference: async () => null,
    findIntegrationByMerchantId: async () => ({
      participant: {
        participantType: ParticipantType.SUPPLIER,
        status: ParticipantStatus.ACTIVE,
        payment: { status: 'VERIFIED' },
      },
    }),
    createSettlement: async () => {
      created.push('parent');
      return {
        id: 'settlement-1',
        status: 'INITIATED',
        amount: 10_000,
        currency: 'KES',
        reference: 'settlement-reference',
        createdAt: new Date(),
      };
    },
    createSupplierSettlement: async () => {
      created.push('supplier');
      return { id: 'supplier-settlement-1', reference: 'supplier-reference' };
    },
    createMultipleTransactions: async () => undefined,
  };
  const logger = { warn() {}, error() {}, log() {} };
  const data = {
    merchantTransactionReference: `test-${Math.random()}`,
    totalAmount: 10_000,
    currency: 'KES',
    settlementMethod: 'MIXED',
    transactionDate: new Date().toISOString(),
    paymentMethod,
    suppliers: [{
      supplierMerchantId: 'supplier-merchant',
      supplierTotalAmount: 10_000,
      retailerTotalAmount: 0,
      platformFee: 0,
      items: [],
    }],
  };

  return { created, repository, logger, session, data };
}

test('missing cash escrow float rejects before creating a settlement', async () => {
  const fixture = makeInitiationFixture({ type: 'CASH', provider: 'ESCROW', amount: 10_000 });
  const originalHasFloatConfig = retailerEscrowTransferService.hasFloatConfig;
  retailerEscrowTransferService.hasFloatConfig = async () => false;

  try {
    await assert.rejects(
      () => initiateOperation({}, fixture.repository, fixture.logger, 'token', fixture.data as any, ['KES']),
      /Retailer escrow daily float is not configured/,
    );
    assert.deepEqual(fixture.created, []);
  } finally {
    retailerEscrowTransferService.hasFloatConfig = originalHasFloatConfig;
  }
});

test('failed customer payment does not create supplier settlements', async () => {
  const fixture = makeInitiationFixture({ type: 'MPESA', provider: 'MPESA', amount: 10_000, payerPhoneNumber: '254700000000' });
  const paymentModule = customerPayment as any;
  const originalInitiateCustomerPayment = paymentModule.initiateCustomerPayment;
  paymentModule.initiateCustomerPayment = async () => ({ success: false, message: 'Payment failed' });

  try {
    const response = await initiateOperation({}, fixture.repository, fixture.logger, 'token', fixture.data as any, ['KES']);
    assert.equal(response.success, false);
    assert.deepEqual(fixture.created, ['parent']);
  } finally {
    paymentModule.initiateCustomerPayment = originalInitiateCustomerPayment;
  }
});
