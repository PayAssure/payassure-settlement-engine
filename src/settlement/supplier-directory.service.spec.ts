import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { toSupplierDirectoryEntry, type SupplierDirectoryRecord } from './supplier-directory.service';

function supplierRecord(payment: Record<string, string | boolean>): SupplierDirectoryRecord {
  return {
    id: 'supplier-record-1',
    businessName: 'Example Supplies',
    businessType: 'LIMITED_COMPANY',
    status: 'ACTIVE',
    payment,
    integrations: [{
      merchantId: 'pay_supplier_001',
      environment: 'production',
      isActive: true,
    }],
  };
}

test('returns supplier merchant and limited M-Pesa payment details with phone masked', () => {
  const result = toSupplierDirectoryEntry(supplierRecord({
    type: 'MPESA',
    accountName: 'Example Supplies',
    provider: 'Safaricom',
    status: 'VERIFIED',
    isVerified: true,
    phoneNumber: '254712345678',
    paymentActivationSecret: 'must-not-be-returned',
  }));

  assert.equal(result.merchantId, 'pay_supplier_001');
  assert.equal(result.payment?.type, 'MPESA');
  assert.equal(result.payment?.phoneNumber, '****5678');
  assert.equal('paymentActivationSecret' in result.payment!, false);
  assert.equal('apiKey' in result.integration!, false);
});

test('returns bank payment metadata and masks the account number', () => {
  const result = toSupplierDirectoryEntry(supplierRecord({
    type: 'BANK',
    accountName: 'Example Supplies',
    bankCode: '07',
    shortcode: '123456',
    accountNumber: '001234567890',
  }));

  assert.equal(result.payment?.type, 'BANK');
  assert.equal(result.payment?.bankCode, '07');
  assert.equal(result.payment?.shortcode, '123456');
  assert.equal(result.payment?.accountNumber, '****7890');
});
