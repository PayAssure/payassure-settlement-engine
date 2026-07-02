import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { InitiateSettlementDto } from './initiate-settlement.dto';

test('rejects transaction items without supplierMerchantId', async () => {
  const dto = plainToInstance(InitiateSettlementDto, {
    amount: 5000,
    currency: 'KES',
    settlementMethod: 'BANK_TRANSFER',
    reference: 'settlement-001',
    transactionItems: [
      {
        itemId: 'item_001',
        type: 'SALE',
        quantity: 5,
        unitPrice: 500,
        amount: 2500,
      },
    ],
  });

  const errors = await validate(dto);
  assert.ok(errors.length > 0, 'expected DTO validation to fail for missing supplierMerchantId');
});

test('accepts transaction items with supplierMerchantId and pricing fields', async () => {
  const dto = plainToInstance(InitiateSettlementDto, {
    amount: 5000,
    currency: 'KES',
    settlementMethod: 'BANK_TRANSFER',
    reference: 'settlement-001',
    transactionItems: [
      {
        itemId: 'item_001',
        supplierMerchantId: 'pay_sup_001',
        type: 'SALE',
        quantity: 5,
        unitPrice: 500,
        amount: 2500,
      },
    ],
  });

  const errors = await validate(dto);
  assert.equal(errors.length, 0, 'expected DTO validation to pass for valid supplier-based item payload');
});
