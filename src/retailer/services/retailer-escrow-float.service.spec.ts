import { test } from 'node:test';
import assert = require('node:assert/strict');
import { prisma } from '../../common/database/prisma';
import { retailerEscrowFloatService } from './retailer-escrow-float.service';

test('creates and returns retailer float till and store identifiers', async () => {
  const integrationModel = (prisma as any).integration;
  const floatModel = (prisma as any).retailerEscrowFloat;
  const original = {
    integrationFindUnique: integrationModel.findUnique,
    floatFindUnique: floatModel.findUnique,
    floatCreate: floatModel.create,
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
        expectedRemainingBalance: data.expectedRemainingBalance,
        tillNumber: data.tillNumber,
        storeNumber: data.storeNumber,
        updatedAt: new Date('2026-10-01T00:00:00.000Z'),
      };
    };

    const result = await retailerEscrowFloatService.setFloat('pay_retailer_001', 10000, undefined, 'TILL-001', 'STORE-001');

    assert.equal(createdData.tillNumber, 'TILL-001');
    assert.equal(createdData.storeNumber, 'STORE-001');
    assert.equal(Number(result.expectedRemainingBalance), 10000);
    assert.equal(result.tillNumber, 'TILL-001');
    assert.equal(result.storeNumber, 'STORE-001');
  } finally {
    integrationModel.findUnique = original.integrationFindUnique;
    floatModel.findUnique = original.floatFindUnique;
    floatModel.create = original.floatCreate;
  }
});

test('editing dailyFloat without location fields preserves the stored float metadata', async () => {
  const integrationModel = (prisma as any).integration;
  const floatModel = (prisma as any).retailerEscrowFloat;
  const original = {
    integrationFindUnique: integrationModel.findUnique,
    floatFindUnique: floatModel.findUnique,
    floatUpdateMany: floatModel.updateMany,
    floatFindUniqueOrThrow: floatModel.findUniqueOrThrow,
  };
  const existing = {
    id: 'float-1',
    merchantId: 'pay_retailer_001',
    currency: 'KES',
    dailyFloat: 10000,
    expectedRemainingBalance: 7000,
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

    const result = await retailerEscrowFloatService.setFloat('pay_retailer_001', 12000);

    assert.equal(updateData.tillNumber, undefined);
    assert.equal(updateData.storeNumber, undefined);
    assert.equal(Number(result.expectedRemainingBalance), 7000);
    assert.equal(result.tillNumber, 'TILL-001');
    assert.equal(result.storeNumber, 'STORE-001');
  } finally {
    integrationModel.findUnique = original.integrationFindUnique;
    floatModel.findUnique = original.floatFindUnique;
    floatModel.updateMany = original.floatUpdateMany;
    floatModel.findUniqueOrThrow = original.floatFindUniqueOrThrow;
  }
});
