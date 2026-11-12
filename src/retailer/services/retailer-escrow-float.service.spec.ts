import { test } from 'node:test';
import assert = require('node:assert/strict');
import { prisma } from '../../common/database/prisma';
import { retailerEscrowFloatService } from './retailer-escrow-float.service';

test('creates and returns a retailer float without unused till and store identifiers', async () => {
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
        updatedAt: new Date('2026-10-01T00:00:00.000Z'),
      };
    };
    depositModel.aggregate = async () => ({ _sum: { amount: null } });
    transferModel.aggregate = async () => ({ _sum: { debitedAmount: null } });

    const result = await retailerEscrowFloatService.setFloat('pay_retailer_001', 10000);

    assert.equal('expectedRemainingBalance' in createdData, false);
    assert.equal('tillNumber' in createdData, false);
    assert.equal('storeNumber' in createdData, false);
    assert.equal(result.availableBalance, 0);
    assert.equal('tillNumber' in result, false);
    assert.equal('storeNumber' in result, false);
  } finally {
    integrationModel.findUnique = original.integrationFindUnique;
    floatModel.findUnique = original.floatFindUnique;
    floatModel.create = original.floatCreate;
    depositModel.aggregate = original.depositAggregate;
    transferModel.aggregate = original.transferAggregate;
  }
});

test('editing dailyFloat updates configuration without unused location fields', async () => {
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
    transferModel.aggregate = async ({ where }: any) => ({
      _sum: { debitedAmount: where.status === 'SUCCEEDED' ? 2000 : 0 },
    });

    const result = await retailerEscrowFloatService.setFloat('pay_retailer_001', 12000);

    assert.deepEqual(Object.keys(updateData), ['dailyFloat']);
    assert.equal(result.availableBalance, 7000);
    assert.equal('tillNumber' in result, false);
    assert.equal('storeNumber' in result, false);
  } finally {
    integrationModel.findUnique = original.integrationFindUnique;
    floatModel.findUnique = original.floatFindUnique;
    floatModel.updateMany = original.floatUpdateMany;
    floatModel.findUniqueOrThrow = original.floatFindUniqueOrThrow;
    depositModel.aggregate = original.depositAggregate;
    transferModel.aggregate = original.transferAggregate;
  }
});

test('virtual balance reports confirmed deposits, completed payouts, and active reservations separately', async () => {
  const floatModel = (prisma as any).retailerEscrowFloat;
  const depositModel = (prisma as any).retailerEscrowFloatDeposit;
  const transferModel = (prisma as any).retailerEscrowTransfer;
  const original = {
    floatFindUnique: floatModel.findUnique,
    depositAggregate: depositModel.aggregate,
    transferAggregate: transferModel.aggregate,
  };
  const aggregateCalls: Array<{ model: string; where: any }> = [];

  try {
    floatModel.findUnique = async () => ({
      id: 'float-balance-test',
      merchantId: 'pay_retailer_balance',
      currency: 'KES',
    });
    depositModel.aggregate = async ({ where }: any) => {
      aggregateCalls.push({ model: 'deposit', where });
      return { _sum: { amount: 12500 } };
    };
    transferModel.aggregate = async ({ where }: any) => {
      aggregateCalls.push({ model: 'transfer', where });
      return { _sum: { debitedAmount: where.status === 'SUCCEEDED' ? 2000 : 1500 } };
    };

    const result = await retailerEscrowFloatService.getBalance('pay_retailer_balance');

    assert.equal(result.merchantId, 'pay_retailer_balance');
    assert.equal(result.currency, 'KES');
    assert.equal(result.depositedBalance, 12500);
    assert.equal(result.paidOutBalance, 2000);
    assert.equal(result.reservedBalance, 1500);
    assert.equal(result.availableBalance, 9000);
    assert.equal(typeof result.asOf, 'string');
    assert.deepEqual(aggregateCalls.find(({ model }) => model === 'deposit')?.where, {
      retailerEscrowFloatId: 'float-balance-test',
      status: 'SUCCEEDED',
    });
    assert.deepEqual(aggregateCalls.filter(({ model }) => model === 'transfer').map(({ where }) => where.status), [
      'SUCCEEDED',
      { in: ['BALANCE_PENDING', 'BALANCE_VERIFIED', 'WAITING_FOR_MPESA', 'TRANSFER_PENDING'] },
    ]);
  } finally {
    floatModel.findUnique = original.floatFindUnique;
    depositModel.aggregate = original.depositAggregate;
    transferModel.aggregate = original.transferAggregate;
  }
});
