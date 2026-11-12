import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { plainToInstance } from 'class-transformer';
import { InitiateSettlementDto } from './dto/initiate-settlement.dto';
import { groupCanonicalItems } from './operations/initiate/helpers/group-canonical-items';
import { normalizeCanonicalSettlement } from './operations/initiate/helpers/normalize-canonical-settlement';
import { createSupplierSettlements } from './operations/initiate/suppliers/create-supplier-settlements';
import { validateSettlementData } from './helpers/validation.helpers';
import { buildSettlementPlan } from './operations/initiate/helpers/build-settlement-plan';
import { buildSettlementResult } from './operations/initiate/helpers/build-settlement-result';

test('groups direct retailer settlement items without creating a supplier allocation', () => {
  const dto = plainToInstance(InitiateSettlementDto, {
    merchantTransactionReference: 'TXN-DIRECT-001',
    totalAmount: 21200,
    currency: 'KES',
    settlementMethod: 'CASH_ESCROW',
    transactionDate: '2026-09-12T20:00:00+03:00',
    paymentMethod: {
      type: 'CASH',
      provider: 'ESCROW',
      amount: 21200,
    },
    items: [{
      supplierMerchantId: null,
      itemReference: 'PLUMB-PVC-001',
      supplierAmount: 19500,
      retailerAmount: 1700,
    }],
  });

  const grouped = groupCanonicalItems(dto.items ?? []);
  assert.equal(grouped.suppliers.length, 1);
  assert.equal(grouped.suppliers[0].supplierMerchantId, null);
  assert.equal(grouped.suppliers[0].supplierTotalAmount, 0);
  assert.equal(grouped.suppliers[0].retailerTotalAmount, 21200);
});

test('direct CASH plan keeps retailer cash and creates no supplier payout allocation', async () => {
  const dto = plainToInstance(InitiateSettlementDto, {
    merchantId: 'pay_retailer_001',
    merchantTransactionReference: 'POS-UNKNOWN-SUPPLIER-001',
    amount: 10,
    currency: 'KES',
    payment: {
      methods: [{ type: 'CASH', amount: 10 }],
    },
    items: [{
      supplierMerchantId: null,
      itemReference: 'POS-PRODUCT-48',
      supplierAmount: 5,
      retailerAmount: 5,
    }],
  });
  const normalized = normalizeCanonicalSettlement(dto);
  const plan = buildSettlementPlan(normalized);
  assert.equal(plan.settlementMode, 'DIRECT');
  assert.equal(plan.paymentMethod, 'CASH');
  assert.equal(plan.cashAmount, 10);
  assert.equal(plan.mpesaAmount, 0);
  assert.equal(plan.supplierPayoutAmount, 0);
  assert.equal(plan.retailerEntitlement, 10);
  assert.equal(plan.retailerCashAlreadyReceived, 10);
  assert.equal(plan.retailerPayoutAmount, 0);
  assert.equal(plan.escrowDebitAmount, 0);
  assert.equal(plan.escrowBalanceCheckRequired, false);
  assert.equal(plan.settlementStatus, 'SETTLED');

  const allocations = await createSupplierSettlements({
    prisma: {},
    repository: {
      createSupplierSettlement: async () => {
        throw new Error('Unregistered supplier must not receive a supplier settlement');
      },
    },
    logger: { log: () => undefined },
    data: { ...normalized, metadata: { ...normalized.metadata, settlementPlan: plan } },
    session: { businessId: 'retailer-business', integrationId: 'retailer-integration' },
    primarySettlement: { id: 'settlement-direct-001' },
    internalMerchantTransactionReference: 'INTERNAL-DIRECT-001',
    retailerMerchantId: 'pay_retailer_001',
  });

  assert.equal(allocations.childSettlements.length, 0);
  assert.equal(allocations.totalSupplierAmount, 0);
  assert.equal(allocations.totalRetailerAmount, 9);
  assert.equal(allocations.totalSystemAmount, 1);
});

test('rejects unknown non-null supplier IDs instead of treating them as direct', async () => {
  const dto = plainToInstance(InitiateSettlementDto, {
    merchantTransactionReference: 'TXN-UNKNOWN-SUPPLIER-001',
    totalAmount: 10,
    currency: 'KES',
    settlementMethod: 'CASH_ESCROW',
    transactionDate: '2026-09-12T20:00:00+03:00',
    paymentMethod: { type: 'CASH', provider: 'ESCROW', amount: 10 },
    suppliers: [{
      supplierMerchantId: 'pos_supplier_001',
      supplierTotalAmount: 5,
      retailerTotalAmount: 5,
      items: [{ itemReference: 'POS-PRODUCT-48', supplierAmount: 5, retailerAmount: 5 }],
    }],
  });

  await assert.rejects(
    () => validateSettlementData(dto, { findIntegrationByMerchantId: async () => null } as any, { warn: () => undefined } as any, ['KES']),
    /Supplier was not found in PayAssure/i,
  );
});

test('DIRECT MPESA plans approve only the eligible MPESA retailer payout', () => {
  const dto = plainToInstance(InitiateSettlementDto, {
    merchantId: 'pay_retailer_001',
    merchantTransactionReference: 'TXN-DIRECT-MPESA-001',
    amount: 10,
    currency: 'KES',
    payment: { methods: [{ type: 'MPESA', amount: 10, phoneNumber: '254700000000' }] },
    items: [{ supplierMerchantId: null, itemReference: 'ITEM-1', supplierAmount: 5, retailerAmount: 5 }],
  });
  const plan = buildSettlementPlan(normalizeCanonicalSettlement(dto));
  assert.equal(plan.settlementMode, 'DIRECT');
  assert.equal(plan.paymentMethod, 'MPESA');
  assert.equal(plan.supplierPayoutAmount, 0);
  assert.equal(plan.retailerPayoutAmount, 9);
  assert.equal(plan.escrowBalanceCheckRequired, false);
});

test('DIRECT CASH_AND_MPESA plans exclude cash from retailer payout', () => {
  const dto = plainToInstance(InitiateSettlementDto, {
    merchantId: 'pay_retailer_001',
    merchantTransactionReference: 'TXN-DIRECT-MIXED-001',
    amount: 10,
    currency: 'KES',
    payment: {
      methods: [
        { type: 'CASH', amount: 4 },
        { type: 'MPESA', amount: 6, phoneNumber: '254700000000' },
      ],
    },
    items: [{ supplierMerchantId: null, itemReference: 'ITEM-1', supplierAmount: 5, retailerAmount: 5 }],
  });
  const plan = buildSettlementPlan(normalizeCanonicalSettlement(dto));
  assert.equal(plan.paymentMethod, 'CASH_AND_MPESA');
  assert.equal(plan.retailerCashAlreadyReceived, 0);
  assert.equal(plan.retailerPayoutAmount, 6);
  assert.equal(plan.escrowBalanceCheckRequired, false);
});

test('mixed supplier and direct CASH allocations reserve only whole KES and retain discarded fractions as fees', () => {
  const dto = plainToInstance(InitiateSettlementDto, {
    merchantId: 'pay_retailer_001',
    merchantTransactionReference: 'TXN-MIXED-CASH-FRACTIONAL-001',
    amount: 20,
    currency: 'KES',
    payment: { methods: [{ type: 'CASH', amount: 20 }] },
    items: [
      { supplierMerchantId: 'pay_supplier_001', itemReference: 'ITEM-SPLIT', supplierAmount: 5, retailerAmount: 5 },
      { supplierMerchantId: null, itemReference: 'ITEM-DIRECT', supplierAmount: 5, retailerAmount: 5 },
    ],
  });

  const normalized = normalizeCanonicalSettlement(dto);
  const plan = buildSettlementPlan(normalized);
  const allocatedSupplier = normalized.suppliers?.find((supplier) => supplier.supplierMerchantId === 'pay_supplier_001');
  const directAllocation = normalized.suppliers?.find((supplier) => supplier.supplierMerchantId == null);
  const settlementResult = buildSettlementResult({
    data: normalized,
    primarySettlement: { id: 'settlement-mixed-cash', reference: 'REF-MIXED-CASH', createdAt: new Date() },
    retailerMerchantId: 'pay_retailer_001',
  } as any, {
    status: 'FAILED' as any,
    estimatedProcessingTime: 'N/A',
  });

  assert.equal(allocatedSupplier?.supplierTotalAmount, 4);
  assert.equal(allocatedSupplier?.retailerTotalAmount, 4);
  assert.equal(directAllocation?.supplierTotalAmount, 0);
  assert.equal(directAllocation?.retailerTotalAmount, 9);
  assert.equal(plan.escrowDebitAmount, 4);
  assert.equal(plan.escrowDebitAmount % 1, 0);
  assert.equal(plan.supplierPayoutAmount, 4);
  assert.equal(normalized.metadata?.calculatedAllocation?.platformFee, 3);
  assert.equal(settlementResult.supplierAmount, 4);
  assert.equal(settlementResult.retailerAmount, 13);
  assert.equal(settlementResult.systemAmount, 3);
  assert.equal(
    normalized.suppliers?.reduce(
      (sum, supplier) => sum
        + Number(supplier.supplierTotalAmount ?? 0)
        + Number(supplier.retailerTotalAmount ?? 0)
        + Number(supplier.platformFee ?? 0),
      0,
    ),
    20,
  );
});

test('SPLIT cash and MPESA plans constrain payouts to supplier and retailer allocations', () => {
  const buildSplitPlan = (methods: Array<Record<string, unknown>>) => {
    const dto = plainToInstance(InitiateSettlementDto, {
      merchantId: 'pay_retailer_001',
      merchantTransactionReference: 'TXN-SPLIT-001',
      amount: 10,
      currency: 'KES',
      payment: { methods },
      items: [{ supplierMerchantId: 'pay_supplier_001', itemReference: 'ITEM-1', supplierAmount: 5, retailerAmount: 5 }],
    });
    return buildSettlementPlan(normalizeCanonicalSettlement(dto));
  };
  const cashPlan = buildSplitPlan([{ type: 'CASH', amount: 10 }]);
  const mpesaPlan = buildSplitPlan([{ type: 'MPESA', amount: 10, phoneNumber: '254700000000' }]);

  assert.equal(cashPlan.settlementMode, 'SPLIT');
  assert.equal(cashPlan.supplierPayoutAmount, 4);
  assert.equal(cashPlan.retailerPayoutAmount, 0);
  assert.equal(cashPlan.escrowDebitAmount, 4);
  assert.equal(cashPlan.escrowBalanceCheckRequired, true);
  assert.equal(mpesaPlan.supplierPayoutAmount, 4);
  assert.equal(mpesaPlan.retailerPayoutAmount, 4);
});
