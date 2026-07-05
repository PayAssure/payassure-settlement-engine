import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { groupTransactionItemsBySupplier } from './settlement.utils';

test('groups transaction items by supplier merchant ID and aggregates amounts', () => {
  // payload uses `supplierAmount` on items; convert to the util input shape
  const payloadItems = [
    {
      itemId: 'item-1',
      supplierMerchantId: 'SUP-1001',
      type: 'SALE',
      quantity: 2,
      unitPrice: 500,
      supplierAmount: 1000,
    },
    {
      itemId: 'item-2',
      supplierMerchantId: 'SUP-1002',
      type: 'SALE',
      quantity: 1,
      unitPrice: 750,
      supplierAmount: 750,
    },
    {
      itemId: 'item-3',
      supplierMerchantId: 'SUP-1001',
      type: 'SALE',
      quantity: 1,
      unitPrice: 300,
      supplierAmount: 300,
    },
  ];

  const groups = groupTransactionItemsBySupplier(
    payloadItems.map((it) => ({
      itemId: it.itemId,
      supplierMerchantId: it.supplierMerchantId,
      type: it.type,
      quantity: it.quantity,
      unitPrice: it.unitPrice,
      amount: it.supplierAmount,
    } as any)),
  );

  assert.equal(groups.length, 2);
  assert.deepEqual(
    groups.map((group) => ({ supplierMerchantId: group.supplierMerchantId, amount: group.amount })),
    [
      { supplierMerchantId: 'SUP-1001', amount: 1300 },
      { supplierMerchantId: 'SUP-1002', amount: 750 },
    ],
  );
});
