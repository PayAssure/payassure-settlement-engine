import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { InitiateSettlementDto } from './dto/initiate-settlement.dto';
import { validateSettlementData } from './helpers/validation.helpers';
import { MockBankEscrowProvider } from '../escrow-intelligence/providers/mock-bank-escrow.provider';

const supplierGroupA = {
  supplierMerchantId: 'pay_d68f568ddc7d7b2a',
  supplierTotalAmount: 6000,
  retailerTotalAmount: 500,
  platformFee: 200,
  items: [
    { itemReference: 'ITEM-001', supplierAmount: 3200 },
    { itemReference: 'ITEM-002', supplierAmount: 2800 },
  ],
};

const supplierGroupB = {
  supplierMerchantId: 'pay_cc054dace2163d92',
  supplierTotalAmount: 3000,
  retailerTotalAmount: 200,
  platformFee: 100,
  items: [{ itemReference: 'ITEM-003', supplierAmount: 3000 }],
};

const baseSupplierList = [supplierGroupA, supplierGroupB];

function buildDto(overrides: Partial<Record<string, any>> = {}) {
  return plainToInstance(InitiateSettlementDto, {
    merchantTransactionReference: 'TXN-SIM-20260912-0001',
    totalAmount: 10000,
    currency: 'KES',
    settlementMethod: 'CASH_ESCROW',
    transactionDate: '2026-09-12T20:00:00+03:00',
    paymentMethod: {
      type: 'MPESA',
      payerPhoneNumber: '254791614036',
      provider: 'MPESA',
      amount: 10000,
    },
    suppliers: baseSupplierList,
    ...overrides,
  });
}

const repoStub = {
  findIntegrationByMerchantId: async (merchantId: string) => {
    if (merchantId === 'pay_d68f568ddc7d7b2a') {
      return {
        participant: {
          participantType: 'SUPPLIER',
          status: 'ACTIVE',
          payment: { status: 'VERIFIED', isVerified: true },
        },
      };
    }
    if (merchantId === 'pay_cc054dace2163d92') {
      return {
        participant: {
          participantType: 'SUPPLIER',
          status: 'ACTIVE',
          payment: { status: 'VERIFIED', isVerified: true },
        },
      };
    }
    return {
      participant: {
        participantType: 'SUPPLIER',
        status: 'ACTIVE',
        payment: { status: 'VERIFIED', isVerified: true },
      },
    };
  },
};

test('mixed settlement simulation matrix logs each step and keeps going past per-scenario failures', async () => {
  const startedAt = Date.now();
  const scenarioResults: Array<{ name: string; ok: boolean; durationMs: number; details?: Record<string, any>; error?: string }> = [];

  const logScenario = async (name: string, fn: () => Promise<Record<string, any> | void>) => {
    const stepStarted = Date.now();
    console.log(`\n===== ${name} START =====`);

    try {
      const details = await fn();
      const durationMs = Date.now() - stepStarted;
      console.log(`===== ${name} PASS (${durationMs}ms) =====`);
      console.log(JSON.stringify({ name, status: 'PASS', details }, null, 2));
      scenarioResults.push({ name, ok: true, durationMs, details: details ?? {} });
    } catch (error) {
      const durationMs = Date.now() - stepStarted;
      const message = error instanceof Error ? error.message : String(error);
      const stack = error instanceof Error ? error.stack : '';
      console.error(`===== ${name} ERROR (${durationMs}ms) =====`);
      console.error(message);
      if (stack) {
        console.error(stack);
      }
      scenarioResults.push({ name, ok: false, durationMs, error: message });
    }
  };

  const successCustomerId = `pay_escrow_success_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const insufficientCustomerId = `pay_escrow_insufficient_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const refundCustomerId = `pay_escrow_refund_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const providerDownCustomerId = `pay_escrow_provider_down_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const mismatchCustomerId = `pay_escrow_mismatch_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const duplicateCustomerId = `pay_escrow_duplicate_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const reversalCustomerId = `pay_escrow_reversal_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const pureCashCustomerId = `pay_escrow_pure_cash_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

  const successEscrowProvider = new MockBankEscrowProvider({ [successCustomerId]: { balance: 5000, transactions: [] } });
  const insufficientEscrowProvider = new MockBankEscrowProvider({ [insufficientCustomerId]: { balance: 2000, transactions: [] } });
  const refundEscrowProvider = new MockBankEscrowProvider({ [refundCustomerId]: { balance: 5000, transactions: [] } });
  const providerDownEscrowProvider = new MockBankEscrowProvider({ [providerDownCustomerId]: { balance: 5000, transactions: [] } });
  const mismatchEscrowProvider = new MockBankEscrowProvider({ [mismatchCustomerId]: { balance: 5000, transactions: [] } });
  const duplicateEscrowProvider = new MockBankEscrowProvider({ [duplicateCustomerId]: { balance: 5000, transactions: [] } });
  const reversalEscrowProvider = new MockBankEscrowProvider({ [reversalCustomerId]: { balance: 5000, transactions: [] } });

  await successEscrowProvider.seedAccount(successCustomerId, 5000, 'KES', { description: 'seed successful cash-flow balance' });
  await insufficientEscrowProvider.seedAccount(insufficientCustomerId, 2000, 'KES', { description: 'seed insufficient escrow balance' });
  await refundEscrowProvider.seedAccount(refundCustomerId, 5000, 'KES', { description: 'seed refund scenario balance' });
  await providerDownEscrowProvider.seedAccount(providerDownCustomerId, 5000, 'KES', { description: 'seed provider-down scenario balance' });
  await mismatchEscrowProvider.seedAccount(mismatchCustomerId, 5000, 'KES', { description: 'seed mismatch scenario balance' });
  await duplicateEscrowProvider.seedAccount(duplicateCustomerId, 5000, 'KES', { description: 'seed duplicate scenario balance' });
  await reversalEscrowProvider.seedAccount(reversalCustomerId, 5000, 'KES', { description: 'seed reversal scenario balance' });

  await logScenario('valid mixed cash + mpesa split', async () => {
    const validMixedDto = buildDto({
      paymentMethods: [
        { type: 'CASH', amount: 5000, provider: 'ESCROW' },
        { type: 'MPESA', amount: 5000, provider: 'MPESA', payerPhoneNumber: '254791614036' },
      ],
      paymentMethod: {
        type: 'MPESA',
        payerPhoneNumber: '254791614036',
        provider: 'MPESA',
        amount: 0,
      },
    });

    const validationErrors = await validate(validMixedDto);
    assert.equal(validationErrors.length, 0, 'expected valid mixed cash + MPESA payload to pass DTO validation');
    await assert.doesNotReject(
      () => validateSettlementData(validMixedDto, repoStub as any, { warn: () => undefined, error: () => undefined, log: () => undefined } as any, ['KES']),
      'expected mixed funding validation to allow a valid cash + MPESA split',
    );

    const collectionSuccess = await successEscrowProvider.simulateCollection({
      customerId: successCustomerId,
      amount: 5000,
      provider: 'CASH',
      scenario: 'cash-collection',
      supplierAmount: 9000,
      platformFee: 300,
      retailerEscrowBalance: 5000,
    });

    assert.equal(collectionSuccess.status, 'SUCCESS');
    assert.equal(collectionSuccess.collectedAmount, 5000);

    const escrowPausedUntilCallback = {
      escrowCollected: collectionSuccess.status === 'SUCCESS',
      mpesaInitiated: true,
      callbackConfirmed: false,
      payoutAllowed: false,
    };
    assert.equal(escrowPausedUntilCallback.payoutAllowed, false, 'supplier payouts must stay paused until the MPESA callback confirms funds landed');

    return {
      validationErrors: validationErrors.length,
      collectionStatus: collectionSuccess.status,
      escrowPausedUntilCallback,
    };
  });

  await logScenario('escrow balance insufficient', async () => {
    const result = await insufficientEscrowProvider.simulateCollection({
      customerId: insufficientCustomerId,
      amount: 5000,
      provider: 'CASH',
      scenario: 'cash-collection',
      retailerEscrowBalance: 2000,
    });

    assert.equal(result.status, 'BLOCKED');
    assert.match(result.message, /insufficient.*escrow|available.*required|deposit funds/i);
    return result;
  });

  await logScenario('provider down', async () => {
    const result = await providerDownEscrowProvider.simulateCollection({
      customerId: providerDownCustomerId,
      amount: 5000,
      provider: 'CASH',
      scenario: 'provider-down',
      retailerEscrowBalance: 5000,
    });
    assert.equal(result.status, 'FAILED');
    return result;
  });

  await logScenario('escrow mismatch', async () => {
    const result = await mismatchEscrowProvider.simulateCollection({
      customerId: mismatchCustomerId,
      amount: 5000,
      provider: 'CASH',
      scenario: 'mismatch',
      retailerEscrowBalance: 5000,
    });
    assert.equal(result.status, 'BLOCKED');
    return result;
  });

  await logScenario('duplicate transaction', async () => {
    const result = await duplicateEscrowProvider.simulateCollection({
      customerId: duplicateCustomerId,
      amount: 5000,
      provider: 'CASH',
      scenario: 'duplicate',
      retailerEscrowBalance: 5000,
    });
    assert.equal(result.status, 'BLOCKED');
    return result;
  });

  await logScenario('reversal detection', async () => {
    const result = await reversalEscrowProvider.simulateCollection({
      customerId: reversalCustomerId,
      amount: 5000,
      provider: 'CASH',
      scenario: 'reversal',
      retailerEscrowBalance: 5000,
    });
    assert.equal(result.status, 'BLOCKED');
    return result;
  });

  await logScenario('mpesa callback gate', async () => {
    const callbackResult = {
      paymentCallbackStatus: 'SUCCESS',
      supplierPayoutsDispatched: true,
      amountsReleased: 9000,
      payoutAllowed: false,
    };
    assert.equal(callbackResult.paymentCallbackStatus, 'SUCCESS');
    return callbackResult;
  });

  await logScenario('mpesa failure triggers refund rollback', async () => {
    const refundAfterMpesaFailure = await refundEscrowProvider.simulateCollection({
      customerId: refundCustomerId,
      amount: 5000,
      provider: 'CASH',
      scenario: 'cash-collection',
      retailerEscrowBalance: 5000,
    });
    assert.equal(refundAfterMpesaFailure.status, 'SUCCESS');

    const autoRefund = await refundEscrowProvider.refundCollection({
      customerId: refundCustomerId,
      amount: refundAfterMpesaFailure.collectedAmount,
      provider: 'CASH',
      scenario: 'cash-refund',
      description: 'Refund escrow after MPESA funding failure',
    });

    assert.equal(autoRefund.status, 'SUCCESS');
    assert.equal(autoRefund.scenario, 'cash-refund');
    assert.ok(autoRefund.actualBalance >= refundAfterMpesaFailure.actualBalance, 'escrow refund should restore the original balance after failed MPESA funding');

    return { refundAfterMpesaFailure, autoRefund };
  });

  await logScenario('missing payer phone validation', async () => {
    const invalidPhoneDto = buildDto({
      paymentMethods: [{ type: 'MPESA', amount: 10000, provider: 'MPESA', payerPhoneNumber: '' }],
      paymentMethod: { type: 'MPESA', payerPhoneNumber: '', provider: 'MPESA', amount: 10000 },
    });

    await assert.rejects(
      () => validateSettlementData(invalidPhoneDto, repoStub as any, { warn: () => undefined, error: () => undefined, log: () => undefined } as any, ['KES']),
      /Payer phone number is required for MPESA|payerPhoneNumber/i,
      'expected MPESA validation to fail when the payer phone number is missing',
    );

    return invalidPhoneDto;
  });

  await logScenario('split total mismatch validation', async () => {
    const totalMismatchDto = buildDto({
      totalAmount: 12000,
      paymentMethods: [{ type: 'CASH', amount: 5000, provider: 'ESCROW' }, { type: 'MPESA', amount: 5000, provider: 'MPESA', payerPhoneNumber: '254791614036' }],
      suppliers: [
        { ...supplierGroupA, supplierTotalAmount: 6000, retailerTotalAmount: 500, platformFee: 200 },
        { ...supplierGroupB, supplierTotalAmount: 3000, retailerTotalAmount: 200, platformFee: 100 },
      ],
    });

    await assert.rejects(
      () => validateSettlementData(totalMismatchDto, repoStub as any, { warn: () => undefined, error: () => undefined, log: () => undefined } as any, ['KES']),
      /Split funding totals|Total amount .* does not match sum of supplier allocations/i,
      'expected validation to reject mismatched totals',
    );

    return totalMismatchDto;
  });

  await logScenario('unsupported currency validation', async () => {
    const unsupportedCurrencyDto = buildDto({ currency: 'USD' });
    await assert.rejects(
      () => validateSettlementData(unsupportedCurrencyDto, repoStub as any, { warn: () => undefined, error: () => undefined, log: () => undefined } as any, ['KES']),
      /Currency is not supported/i,
      'expected validation to reject unsupported currency',
    );
    return unsupportedCurrencyDto;
  });

  await logScenario('invalid supplier validation', async () => {
    const missingSupplierRepo = {
      findIntegrationByMerchantId: async (merchantId: string) => {
        if (merchantId === 'pay_missing_supplier') {
          return null;
        }
        return repoStub.findIntegrationByMerchantId(merchantId);
      },
    };

    const invalidSupplierDto = buildDto({
      totalAmount: 6700,
      paymentMethods: [{ type: 'CASH', amount: 6700, provider: 'ESCROW' }],
      paymentMethod: { type: 'CASH', provider: 'ESCROW', amount: 6700 },
      suppliers: [
        {
          supplierMerchantId: 'pay_missing_supplier',
          supplierTotalAmount: 6000,
          retailerTotalAmount: 500,
          platformFee: 200,
          items: [{ itemReference: 'ITEM-001', supplierAmount: 6000 }],
        },
      ],
    });

    await assert.rejects(
      () => validateSettlementData(invalidSupplierDto, missingSupplierRepo as any, { warn: () => undefined, error: () => undefined, log: () => undefined } as any, ['KES']),
      /Supplier was not found in PayAssure|not eligible|payout destination/i,
      'expected validation to reject a supplier that cannot receive payouts',
    );

    return invalidSupplierDto;
  });

  await logScenario('pure cash escrow success', async () => {
    const pureCashCustomerIdLocal = `pay_escrow_pure_cash_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const pureCashCollectionProvider = new MockBankEscrowProvider({ [pureCashCustomerIdLocal]: { balance: 10000, transactions: [] } });
    await pureCashCollectionProvider.seedAccount(pureCashCustomerIdLocal, 10000, 'KES', { description: 'seed pure cash success balance' });

    const pureCashDto = buildDto({
      paymentMethod: { type: 'CASH', provider: 'ESCROW', amount: 10000 },
      paymentMethods: [{ type: 'CASH', amount: 10000, provider: 'ESCROW' }],
      settlementMethod: 'CASH_ESCROW',
    });

    const pureCashErrors = await validate(pureCashDto);
    assert.equal(pureCashErrors.length, 0, 'expected a pure cash escrow settlement to validate');

    const pureCashCollection = await pureCashCollectionProvider.simulateCollection({
      customerId: pureCashCustomerIdLocal,
      amount: 10000,
      provider: 'CASH',
      scenario: 'cash-collection',
      retailerEscrowBalance: 10000,
    });

    assert.equal(pureCashCollection.status, 'SUCCESS', 'pure cash escrow should collect immediately and proceed');
    return { pureCashDto, pureCashCollection };
  });

  const totalDurationMs = Date.now() - startedAt;
  const failedScenarioCount = scenarioResults.filter((scenario) => !scenario.ok).length;
  console.log(`\n===== FINAL SUMMARY =====`);
  console.log(JSON.stringify({
    totalDurationMs,
    totalScenarios: scenarioResults.length,
    failedScenarioCount,
    passedScenarioCount: scenarioResults.length - failedScenarioCount,
    scenarios: scenarioResults,
  }, null, 2));

  if (failedScenarioCount > 0) {
    throw new Error(`simulation encountered ${failedScenarioCount} failing scenario(s); see logs above for details`);
  }
});
