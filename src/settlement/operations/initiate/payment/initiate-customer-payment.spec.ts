import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import { SettlementStatus } from '@prisma/client';
import * as mpesaCustomerPayment from './initiate-mpesa-customer-payment';
import { retailerEscrowTransferService } from '../../../../retailer';
import { initiateCustomerPayment } from './initiate-customer-payment';

function makeContext(paymentMethods: Array<Record<string, unknown>>) {
  const updates: Array<{ status: string; metadata: Record<string, unknown> }> = [];
  const data = {
    merchantTransactionReference: 'mixed-funding-1',
    totalAmount: 100,
    currency: 'KES',
    paymentMethod: paymentMethods[0],
    paymentMethods,
    metadata: {},
  } as any;
  const context = {
    data,
    repository: {
      updateSettlementStatus: async (_id: string, status: string, update: { metadata: Record<string, unknown> }) => {
        updates.push({ status, metadata: update.metadata });
      },
    },
    logger: { warn() {}, error() {}, log() {} },
    primarySettlement: {
      id: 'settlement-1',
      reference: 'settlement-reference',
      createdAt: new Date(),
    },
    retailerMerchantId: 'retailer-merchant',
  } as any;
  return { context, updates };
}

test('mixed customer funding collects MPESA directly and defers CASH escrow until the MPESA callback', async () => {
  const fixture = makeContext([
    { type: 'CASH', amount: 40, provider: 'ESCROW' },
    { type: 'MPESA', amount: 60, provider: 'MPESA', payerPhoneNumber: '0791614036' },
  ]);
  const originalHasFloatConfig = retailerEscrowTransferService.hasFloatConfig;
  const originalStartForSettlement = retailerEscrowTransferService.startForSettlement;
  const originalInitiateMpesa = mpesaCustomerPayment.initiateMpesaCustomerPayment;
  let escrowStarted = false;
  let mpesaFunding: { amount: number; payerPhoneNumber: string } | undefined;

  retailerEscrowTransferService.hasFloatConfig = async () => true;
  retailerEscrowTransferService.startForSettlement = async () => {
    escrowStarted = true;
    return { accepted: true };
  };
  (mpesaCustomerPayment as any).initiateMpesaCustomerPayment = async (_context: unknown, funding: typeof mpesaFunding) => {
    mpesaFunding = funding;
    return undefined;
  };

  try {
    const result = await initiateCustomerPayment(fixture.context);
    const fundingPlan = fixture.updates[0]?.metadata.fundingPlan as Record<string, unknown>;

    assert.ok(result);
    assert.equal(result.success, true);
    assert.deepEqual(mpesaFunding, { amount: 60, payerPhoneNumber: '0791614036' });
    assert.equal(escrowStarted, false);
    assert.equal(fixture.updates[0]?.status, SettlementStatus.PENDING_PROCESSING);
    assert.deepEqual(fundingPlan, {
      cashAmount: 40,
      mpesaAmount: 60,
      mpesaStatus: 'WAITING_FOR_CUSTOMER',
      cashStatus: 'WAITING_FOR_MPESA',
      retailerMerchantId: 'retailer-merchant',
    });
  } finally {
    retailerEscrowTransferService.hasFloatConfig = originalHasFloatConfig;
    retailerEscrowTransferService.startForSettlement = originalStartForSettlement;
    (mpesaCustomerPayment as any).initiateMpesaCustomerPayment = originalInitiateMpesa;
  }
});

test('cash-only customer funding starts an escrow transfer without an MPESA leg', async () => {
  const fixture = makeContext([{ type: 'CASH', amount: 100, provider: 'ESCROW' }]);
  const originalHasFloatConfig = retailerEscrowTransferService.hasFloatConfig;
  const originalStartForSettlement = retailerEscrowTransferService.startForSettlement;
  let transferRequest: Record<string, unknown> | undefined;

  retailerEscrowTransferService.hasFloatConfig = async () => true;
  retailerEscrowTransferService.startForSettlement = async (request: Record<string, unknown>) => {
    transferRequest = request;
    return { accepted: true };
  };

  try {
    const result = await initiateCustomerPayment(fixture.context);

    assert.equal(transferRequest?.cashAmount, 100);
    assert.equal(transferRequest?.mpesaAmount, 0);
    assert.equal(transferRequest?.mpesaPayerPhone, undefined);
    assert.ok(result && 'cashAllocationReady' in result && result.cashAllocationReady);
  } finally {
    retailerEscrowTransferService.hasFloatConfig = originalHasFloatConfig;
    retailerEscrowTransferService.startForSettlement = originalStartForSettlement;
  }
});

test('MPESA-only customer funding does not query or start retailer escrow', async () => {
  const fixture = makeContext([
    { type: 'MPESA', amount: 100, provider: 'MPESA', payerPhoneNumber: '+254791614036' },
  ]);
  const originalHasFloatConfig = retailerEscrowTransferService.hasFloatConfig;
  const originalStartForSettlement = retailerEscrowTransferService.startForSettlement;
  const originalInitiateMpesa = mpesaCustomerPayment.initiateMpesaCustomerPayment;
  let escrowTouched = false;
  let mpesaFunding: { amount: number; payerPhoneNumber: string } | undefined;

  retailerEscrowTransferService.hasFloatConfig = async () => {
    escrowTouched = true;
    return true;
  };
  retailerEscrowTransferService.startForSettlement = async () => {
    escrowTouched = true;
    return { accepted: true };
  };
  (mpesaCustomerPayment as any).initiateMpesaCustomerPayment = async (_context: unknown, funding: typeof mpesaFunding) => {
    mpesaFunding = funding;
    return undefined;
  };

  try {
    await initiateCustomerPayment(fixture.context);

    assert.equal(escrowTouched, false);
    assert.deepEqual(mpesaFunding, { amount: 100, payerPhoneNumber: '+254791614036' });
    assert.equal(fixture.updates.length, 0);
  } finally {
    retailerEscrowTransferService.hasFloatConfig = originalHasFloatConfig;
    retailerEscrowTransferService.startForSettlement = originalStartForSettlement;
    (mpesaCustomerPayment as any).initiateMpesaCustomerPayment = originalInitiateMpesa;
  }
});
