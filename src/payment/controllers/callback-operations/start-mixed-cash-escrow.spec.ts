import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import { prisma } from '../../../common/database/prisma';
import { retailerEscrowTransferService } from '../../../retailer';
import { startMixedCashEscrowAfterMpesa } from './start-mixed-cash-escrow';

test('successful mixed MPESA callback starts escrow for the cash amount only', async () => {
  const originalFindSettlement = prisma.settlement.findFirst;
  const originalFindSettlementById = prisma.settlement.findUnique;
  const originalUpdateSettlement = prisma.settlement.update;
  const originalFindTransfer = prisma.retailerEscrowTransfer.findUnique;
  const originalStartTransfer = retailerEscrowTransferService.startForSettlement;
  const updates: Array<Record<string, any>> = [];
  let transferRequest: Record<string, unknown> | undefined;

  (prisma.settlement as any).findFirst = async () => ({
    id: 'settlement-mixed-1',
    metadata: {
      fundingPlan: {
        cashAmount: 40,
        mpesaAmount: 60,
        mpesaStatus: 'WAITING_FOR_CUSTOMER',
        retailerMerchantId: 'retailer-merchant',
      },
    },
  });
  (prisma.settlement as any).update = async (request: Record<string, any>) => {
    updates.push(request);
  };
  (prisma.settlement as any).findUnique = async () => ({
    metadata: {
      fundingPlan: {
        cashAmount: 40,
        mpesaAmount: 60,
        mpesaStatus: 'SUCCESS',
        cashStatus: 'STARTING',
        retailerMerchantId: 'retailer-merchant',
      },
      escrowFunding: { payoutSource: 'CENTRAL_ACCOUNT', transferId: 'transfer-1' },
    },
  });
  (prisma.retailerEscrowTransfer as any).findUnique = async () => null;
  retailerEscrowTransferService.startForSettlement = async (request: Record<string, unknown>) => {
    transferRequest = request;
  return { accepted: true, status: 'BALANCE_VERIFIED', transferId: 'transfer-1' };
  };

  try {
    await startMixedCashEscrowAfterMpesa('mixed-reference', { log() {}, error() {} } as any);

    assert.equal(transferRequest?.cashAmount, 40);
    assert.equal(transferRequest?.mpesaAmount, 0);
    assert.equal(transferRequest?.mpesaPayerPhone, undefined);
    assert.equal(updates.length, 2);
    assert.equal((updates[0].data.metadata.fundingPlan as Record<string, unknown>).mpesaStatus, 'SUCCESS');
    assert.equal((updates[1].data.metadata.fundingPlan as Record<string, unknown>).cashStatus, 'BALANCE_VERIFIED');
    assert.equal((updates[1].data.metadata.escrowFunding as Record<string, unknown>).payoutSource, 'CENTRAL_ACCOUNT');
  } finally {
    (prisma.settlement as any).findFirst = originalFindSettlement;
    (prisma.settlement as any).update = originalUpdateSettlement;
    (prisma.settlement as any).findUnique = originalFindSettlementById;
    (prisma.retailerEscrowTransfer as any).findUnique = originalFindTransfer;
    retailerEscrowTransferService.startForSettlement = originalStartTransfer;
  }
});
