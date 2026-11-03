import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { toSupplierDirectoryEntry, type SupplierDirectoryRecord } from './supplier-directory.service';

function supplierRecord(payment: Record<string, string | boolean>): SupplierDirectoryRecord {
  return {
    id: 'supplier-record-1',
    participantType: 'SUPPLIER',
    businessName: 'Example Supplies',
    businessType: 'LIMITED_COMPANY',
    contactName: 'Alex Example',
    email: 'alex@example.com',
    phoneNumber: '+254700000123',
    physicalAddress: 'Nairobi, Kenya',
    status: 'ACTIVE',
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    updatedAt: new Date('2026-01-02T00:00:00.000Z'),
    payment,
    integrations: [{
      id: 'integration-1',
      merchantId: 'pay_supplier_001',
      environment: 'production',
      isActive: true,
      createdAt: new Date('2026-01-01T00:00:00.000Z'),
    }],
  };
}

test('returns supplier contact details and safe integration metadata', () => {
  const result = toSupplierDirectoryEntry(supplierRecord({}));

  assert.equal(result.participantType, 'SUPPLIER');
  assert.equal(result.contactName, 'Alex Example');
  assert.equal(result.email, 'alex@example.com');
  assert.equal(result.phoneNumber, '+254700000123');
  assert.equal(result.physicalAddress, 'Nairobi, Kenya');
  assert.equal(result.integration?.id, 'integration-1');
  assert.equal(result.integration?.merchantId, 'pay_supplier_001');
  assert.equal(result.integration?.createdAt.toISOString(), '2026-01-01T00:00:00.000Z');
  assert.equal(result.createdAt.toISOString(), '2026-01-01T00:00:00.000Z');
  assert.equal(result.updatedAt.toISOString(), '2026-01-02T00:00:00.000Z');
  assert.equal('apiKey' in result.integration!, false);
  assert.equal('apiSecret' in result.integration!, false);
});

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
