import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { SupplierProductsService } from './supplier-products.service';

test('returns all mock retailer items for a supplier merchant ID', () => {
  const service = new SupplierProductsService();
  const result = service.getProductsBySupplier('pay_supplier_cement_001');

  assert.equal(result.success, true);
  assert.equal(result.count, 4);
  assert.equal(result.retailers.length, 2);
  assert.equal(result.retailers[0].items[0].itemReference, 'CEMENT-50KG-001');
});

test('returns only the connected supplier items for a specific retailer', () => {
  const service = new SupplierProductsService();
  const result = service.getSupplierProductsForRetailer('pay_supplier_cement_001', 'pay_retailer_001');

  assert.equal(result.success, true);
  assert.equal(result.retailerMerchantId, 'pay_retailer_001');
  assert.equal(result.count, 3);
  assert.equal(result.items[0].itemId, 'ITEM-CEMENT-001');
});

test('rejects an unknown supplier and retailer connection', () => {
  const service = new SupplierProductsService();

  assert.throws(
    () => service.getSupplierProductsForRetailer('pay_supplier_unknown', 'pay_retailer_unknown'),
    /No product connection found/,
  );
});