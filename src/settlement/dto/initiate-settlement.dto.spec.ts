import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { InitiateSettlementDto } from './initiate-settlement.dto';

test('rejects settlement payload without supplier allocations', async () => {
  const dto = plainToInstance(InitiateSettlementDto, {
    merchantTransactionReference: 'TXN-001',
    totalAmount: 5000,
    currency: 'KES',
    settlementMethod: 'BANK_TRANSFER',
    paymentMethod: {
      type: 'MPESA',
      payerPhoneNumber: '254712345678',
    },
    transactionDate: '2026-07-03T17:30:15+03:00',
    suppliers: [],
  });

  const errors = await validate(dto);
  assert.ok(errors.length > 0, 'expected DTO validation to fail when suppliers are missing');
});

test('accepts supplier-based settlement payload with optional metadata', async () => {
  const dto = plainToInstance(InitiateSettlementDto, {
    merchantTransactionReference: 'TXN-0001',
    totalAmount: 16500,
    currency: 'KES',
    settlementMethod: 'BANK_TRANSFER',
    paymentMethod: {
      type: 'MPESA',
      payerPhoneNumber: '254712345678',
    },
    transactionDate: '2026-07-03T17:30:15+03:00',
    metadata: {
      branchId: 'BR-01',
      terminalId: 'POS-03',
    },
    suppliers: [
      {
        supplierMerchantId: 'SUP-1001',
        items: [
          {
            itemId: 'ITEM-001',
            itemName: 'Cement 50kg',
            supplierAmount: 3200,
            retailerAmount: 400,
            platformFee: 28.8,
            quantity: 10,
            unitPrice: 320,
          },
          {
            itemId: 'ITEM-002',
            itemName: 'Roofing Nails',
            supplierAmount: 4000,
            retailerAmount: 500,
            platformFee: 36,
            quantity: 20,
            unitPrice: 200,
          },
        ],
      },
    ],
  });

  const errors = await validate(dto);
  assert.equal(errors.length, 0, 'expected DTO validation to pass for valid supplier-based settlement payload');
});

test('rejects supplier total mismatch against item allocations', async () => {
  const dto = plainToInstance(InitiateSettlementDto, {
    merchantTransactionReference: 'TXN-0002',
    totalAmount: 7200,
    currency: 'KES',
    settlementMethod: 'BANK_TRANSFER',
    paymentMethod: {
      type: 'MPESA',
      payerPhoneNumber: '254712345678',
    },
    transactionDate: '2026-07-03T17:30:15+03:00',
    suppliers: [
      {
        supplierMerchantId: 'SUP-1001',
        supplierTotalAmount: 7300,
        items: [
          {
            itemId: 'ITEM-001',
            supplierAmount: 3200,
          },
          {
            itemId: 'ITEM-002',
            supplierAmount: 4000,
          },
        ],
      },
    ],
  });

  const errors = await validate(dto);
  assert.ok(errors.length > 0, 'expected DTO validation to fail for supplier total mismatch');
});
