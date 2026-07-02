import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { groupTransactionItemsBySupplier } from './settlement.utils';

test('groups transaction items by supplier merchant ID and aggregates amounts', () => {
  const groups = groupTransactionItemsBySupplier([
    {
      itemId: 'item-1',
      supplierMerchantId: 'pay_sup_001',
      type: 'SALE',
      quantity: 2,
      unitPrice: 500,
      amount: 1000,
    },
    {
      itemId: 'item-2',
      supplierMerchantId: 'pay_sup_002',
      type: 'SALE',
      quantity: 1,
      unitPrice: 750,
      amount: 750,
    },
    {
      itemId: 'item-3',
      supplierMerchantId: 'pay_sup_001',
      type: 'SALE',
      quantity: 1,
      unitPrice: 300,
      amount: 300,
    },
  ] as any);

  assert.equal(groups.length, 2);
  assert.deepEqual(
    groups.map((group) => ({ supplierMerchantId: group.supplierMerchantId, amount: group.amount })),
    [
      { supplierMerchantId: 'pay_sup_001', amount: 1300 },
      { supplierMerchantId: 'pay_sup_002', amount: 750 },
    ],
  );
});
