import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import { prisma } from '../../../common/database/prisma';
import { retailerEscrowBalanceService } from '../balance/retailer-escrow-balance.service';
import { retailerEscrowReconciliationService } from './retailer-escrow-reconciliation.service';

test('shared escrow reconciliation persists and flags a balance mismatch', async () => {
  const model = (prisma as any).retailerEscrowReconciliation;
  const original = {
    findUnique: model.findUnique,
    updateMany: model.updateMany,
  };
  const reconciliation = { id: 'reconciliation-test', status: 'PENDING', expectedBalance: 10000 };
  let persistedUpdate: any;

  try {
    model.findUnique = async () => reconciliation;
    model.updateMany = async ({ where, data }: any) => {
      assert.equal(where.status, 'PENDING');
      persistedUpdate = data;
      return { count: 1 };
    };

    const result = await retailerEscrowReconciliationService.handleCallback('reconciliation-test', {
      Result: {
        ResultCode: 0,
        ResultParameters: {
          ResultParameter: [{ Key: 'AccountBalance', Value: 'Working Account|KES|9,000.00' }],
        },
      },
    });

    assert.equal(result.status, 'MISMATCH');
    assert.equal(result.expectedBalance, 10000);
    assert.equal(result.observedBalance, 9000);
    assert.equal(result.difference, -1000);
    assert.equal(persistedUpdate.status, 'MISMATCH');
    assert.equal(Number(persistedUpdate.observedBalance), 9000);
    assert.equal(Number(persistedUpdate.difference), -1000);
    assert.match(persistedUpdate.failureReason, /mismatch/);
  } finally {
    model.findUnique = original.findUnique;
    model.updateMany = original.updateMany;
  }
});

test('shared escrow expected balance is successful deposits minus successful settlements', async () => {
  const depositModel = (prisma as any).retailerEscrowFloatDeposit;
  const transferModel = (prisma as any).retailerEscrowTransfer;
  const reconciliationModel = (prisma as any).retailerEscrowReconciliation;
  const original = {
    transaction: (prisma as any).$transaction,
    depositAggregate: depositModel.aggregate,
    transferAggregate: transferModel.aggregate,
    reconciliationCreate: reconciliationModel.create,
    reconciliationUpdate: reconciliationModel.update,
    queryBalance: retailerEscrowBalanceService.queryBalance,
  };
  let createdData: any;

  try {
    (prisma as any).$transaction = async (callback: (tx: any) => Promise<unknown>) => callback(prisma);
    depositModel.aggregate = async ({ where }: any) => {
      assert.equal(where.status, 'SUCCEEDED');
      return { _sum: { amount: 12000 } };
    };
    transferModel.aggregate = async ({ where }: any) => {
      assert.equal(where.status, 'SUCCEEDED');
      return { _sum: { amount: 4000 } };
    };
    reconciliationModel.create = async ({ data }: any) => {
      createdData = data;
      return { id: 'reconciliation-source-test' };
    };
    reconciliationModel.update = async () => ({});
    retailerEscrowBalanceService.queryBalance = async () => ({ ResponseCode: '0' });

    const result = await retailerEscrowReconciliationService.requestReconciliation();

    assert.equal(Number(createdData.expectedBalance), 8000);
    assert.equal(result.expectedBalance, 8000);
  } finally {
    (prisma as any).$transaction = original.transaction;
    depositModel.aggregate = original.depositAggregate;
    transferModel.aggregate = original.transferAggregate;
    reconciliationModel.create = original.reconciliationCreate;
    reconciliationModel.update = original.reconciliationUpdate;
    retailerEscrowBalanceService.queryBalance = original.queryBalance;
  }
});