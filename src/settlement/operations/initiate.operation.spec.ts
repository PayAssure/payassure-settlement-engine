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

test('cash settlement allocates after the DB balance has been reserved', async () => {
  const fixture = makeInitiationFixture({ type: 'CASH', provider: 'ESCROW', amount: 10_000 });
  const paymentModule = customerPayment as any;
  const originalInitiateCustomerPayment = paymentModule.initiateCustomerPayment;
  const originalHasFloatConfig = retailerEscrowTransferService.hasFloatConfig;
  let allocationCalled = false;
  paymentModule.initiateCustomerPayment = async () => ({
    success: true,
    cashAllocationReady: true,
    settlement: { settlementId: 'settlement-1', status: 'PENDING_PROCESSING' },
    message: 'DB balance reserved',
  });
  retailerEscrowTransferService.hasFloatConfig = async () => true;

  try {
    const response = await initiateOperation(
      {},
      fixture.repository,
      fixture.logger,
      'token',
      fixture.data as any,
      ['KES'],
      async ({ merchantTransactionReference }) => {
        allocationCalled = true;
        assert.equal(merchantTransactionReference, fixture.data.merchantTransactionReference);
        assert.deepEqual(fixture.created, ['parent', 'supplier']);
        return { success: true, status: 'PROCESSING', message: 'Payouts dispatched' };
      },
    );

    assert.equal(allocationCalled, true);
    assert.equal(response.success, true);
    assert.equal(response.settlement.status, 'PROCESSING');
  } finally {
    paymentModule.initiateCustomerPayment = originalInitiateCustomerPayment;
    retailerEscrowTransferService.hasFloatConfig = originalHasFloatConfig;
  }
});

test('DIRECT CASH settles without entering escrow checks, allocation, or customer payment flow', async () => {
  const fixture = makeInitiationFixture({ type: 'CASH', provider: 'ESCROW', amount: 10 });
  fixture.data = {
    merchantId: 'retailer-merchant',
    merchantTransactionReference: 'POS-DIRECT-CASH-001',
    amount: 10,
    totalAmount: 10,
    currency: 'KES',
    settlementMethod: 'CASH_ESCROW',
    payment: { methods: [{ type: 'CASH', amount: 10 }] },
    paymentMethod: { type: 'CASH', provider: 'ESCROW', amount: 10 },
    items: [{ supplierMerchantId: null, itemReference: 'POS-ITEM-001', supplierAmount: 5, retailerAmount: 5 }],
    suppliers: [],
    transactionDate: new Date().toISOString(),
    metadata: {},
  } as any;
  const originalHasFloatConfig = retailerEscrowTransferService.hasFloatConfig;
  const originalStartForSettlement = retailerEscrowTransferService.startForSettlement;
  const paymentModule = customerPayment as any;
  const originalInitiateCustomerPayment = paymentModule.initiateCustomerPayment;
  let floatChecks = 0;
  let escrowReservations = 0;
  let customerPaymentCalls = 0;
  let settlementUpdate: any;
  (fixture.repository as any).updateSettlementStatus = async (_id: string, _status: string, update: any) => {
    settlementUpdate = update;
  };
  retailerEscrowTransferService.hasFloatConfig = async () => {
    floatChecks += 1;
    return true;
  };
  retailerEscrowTransferService.startForSettlement = async () => {
    escrowReservations += 1;
    throw new Error('DIRECT CASH must not reserve escrow');
  };
  paymentModule.initiateCustomerPayment = async () => {
    customerPaymentCalls += 1;
    throw new Error('DIRECT CASH must not enter the payment workflow');
  };

  try {
    const response: any = await initiateOperation(
      {},
      fixture.repository,
      fixture.logger,
      'token',
      fixture.data as any,
      ['KES'],
      async () => {
        throw new Error('DIRECT CASH must not invoke cash payout allocation');
      },
    );

    assert.equal(response.settlementStatus, 'SETTLED');
    assert.equal(response.settlementPlan.retailerPayoutAmount, 0);
    assert.equal(response.settlementPlan.supplierPayoutAmount, 0);
    assert.equal(response.settlementPlan.escrowBalanceCheckRequired, false);
    assert.equal(floatChecks, 0);
    assert.equal(escrowReservations, 0);
    assert.equal(customerPaymentCalls, 0);
    assert.equal(settlementUpdate.settlementPlan.settlementStatus, 'SETTLED');
    assert.equal(settlementUpdate.paymentConfirmation.provider, 'CASH');
  } finally {
    retailerEscrowTransferService.hasFloatConfig = originalHasFloatConfig;
    retailerEscrowTransferService.startForSettlement = originalStartForSettlement;
    paymentModule.initiateCustomerPayment = originalInitiateCustomerPayment;
  }
});
