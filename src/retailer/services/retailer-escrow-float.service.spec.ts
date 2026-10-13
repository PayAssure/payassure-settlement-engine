import { test } from 'node:test';
import assert = require('node:assert/strict');
import { prisma } from '../../common/database/prisma';
import { retailerEscrowFloatService } from './retailer-escrow-float.service';

test('creates and returns retailer float till and store identifiers', async () => {
  const integrationModel = (prisma as any).integration;
  const floatModel = (prisma as any).retailerEscrowFloat;
  const depositModel = (prisma as any).retailerEscrowFloatDeposit;
  const transferModel = (prisma as any).retailerEscrowTransfer;
  const original = {
    integrationFindUnique: integrationModel.findUnique,
    floatFindUnique: floatModel.findUnique,
    floatCreate: floatModel.create,
    depositAggregate: depositModel.aggregate,
    transferAggregate: transferModel.aggregate,
  };
  let createdData: any;

  try {
    integrationModel.findUnique = async () => ({ participant: { participantType: 'RETAILER' } });
    floatModel.findUnique = async () => null;
    floatModel.create = async ({ data }: any) => {
      createdData = data;
      return {
        merchantId: data.merchantId,
        currency: 'KES',
        dailyFloat: data.dailyFloat,
        tillNumber: data.tillNumber,
        storeNumber: data.storeNumber,
        updatedAt: new Date('2026-10-01T00:00:00.000Z'),
      };
    };
    depositModel.aggregate = async () => ({ _sum: { amount: null } });
    transferModel.aggregate = async () => ({ _sum: { amount: null } });

    const result = await retailerEscrowFloatService.setFloat('pay_retailer_001', 10000, 'TILL-001', 'STORE-001');

    assert.equal('expectedRemainingBalance' in createdData, false);
    assert.equal(createdData.tillNumber, 'TILL-001');
    assert.equal(createdData.storeNumber, 'STORE-001');
    assert.equal(result.availableBalance, 0);
    assert.equal(result.tillNumber, 'TILL-001');
    assert.equal(result.storeNumber, 'STORE-001');
  } finally {
    integrationModel.findUnique = original.integrationFindUnique;
    floatModel.findUnique = original.floatFindUnique;
    floatModel.create = original.floatCreate;
    depositModel.aggregate = original.depositAggregate;
    transferModel.aggregate = original.transferAggregate;
  }
});

test('editing dailyFloat without location fields preserves the stored float metadata', async () => {
  const integrationModel = (prisma as any).integration;
  const floatModel = (prisma as any).retailerEscrowFloat;
  const depositModel = (prisma as any).retailerEscrowFloatDeposit;
  const transferModel = (prisma as any).retailerEscrowTransfer;
  const original = {
    integrationFindUnique: integrationModel.findUnique,
    floatFindUnique: floatModel.findUnique,
    floatUpdateMany: floatModel.updateMany,
    floatFindUniqueOrThrow: floatModel.findUniqueOrThrow,
    depositAggregate: depositModel.aggregate,
    transferAggregate: transferModel.aggregate,
  };
  const existing = {
    id: 'float-1',
    merchantId: 'pay_retailer_001',
    currency: 'KES',
    dailyFloat: 10000,
    tillNumber: 'TILL-001',
    storeNumber: 'STORE-001',
    activeTransferId: null,
  };
  let updateData: any;

  try {
    integrationModel.findUnique = async () => ({ participant: { participantType: 'RETAILER' } });
    floatModel.findUnique = async () => existing;
    floatModel.updateMany = async ({ data }: any) => {
      updateData = data;
      return { count: 1 };
    };
    floatModel.findUniqueOrThrow = async () => ({
      ...existing,
      dailyFloat: updateData.dailyFloat,
    });
    depositModel.aggregate = async () => ({ _sum: { amount: 9000 } });
    transferModel.aggregate = async () => ({ _sum: { amount: 2000 } });

    const result = await retailerEscrowFloatService.setFloat('pay_retailer_001', 12000);

    assert.equal(updateData.tillNumber, undefined);
    assert.equal(updateData.storeNumber, undefined);
    assert.equal(result.availableBalance, 7000);
    assert.equal(result.tillNumber, 'TILL-001');
    assert.equal(result.storeNumber, 'STORE-001');
  } finally {
    integrationModel.findUnique = original.integrationFindUnique;
    floatModel.findUnique = original.floatFindUnique;
    floatModel.updateMany = original.floatUpdateMany;
    floatModel.findUniqueOrThrow = original.floatFindUniqueOrThrow;
    depositModel.aggregate = original.depositAggregate;
    transferModel.aggregate = original.transferAggregate;
  }
});
