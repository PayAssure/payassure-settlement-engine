import { test } from 'node:test';
import * as assert from 'node:assert/strict';

import { EscrowIntelligenceService } from './escrow-intelligence.service';
import { MockBankEscrowProvider } from './providers/mock-bank-escrow.provider';

test('reconcileEscrow blocks settlement when expected balance diverges from bank balance', async () => {
  const provider = new MockBankEscrowProvider({
    'CUST-100': {
      balance: 1100,
      transactions: [
        { id: 'txn-1', customerId: 'CUST-100', date: '2026-09-12', type: 'CREDIT', amount: 2000, description: 'Customer deposit' },
        { id: 'txn-2', customerId: 'CUST-100', date: '2026-09-12', type: 'DEBIT', amount: 900, description: 'Settlement payout' },
      ],
    },
  });

  const service = new EscrowIntelligenceService(provider);
  service.setExpectedTransactions('CUST-100', [
    { id: 'txn-100-1', customerId: 'CUST-100', date: '2026-09-12', type: 'CREDIT', amount: 2000, description: 'Customer deposit' },
    { id: 'txn-100-2', customerId: 'CUST-100', date: '2026-09-12', type: 'DEBIT', amount: 800, description: 'Settlement payout' },
  ]);

  const result = await service.reconcileEscrow('CUST-100', new Date('2026-09-12'));

  assert.equal(result.status, 'BLOCKED');
  assert.equal(result.expectedBalance, 1200);
  assert.equal(result.actualBalance, 1100);
  assert.equal(result.delta, -100);
  assert.equal(result.blockedSettlement, true);
  assert.ok(result.alerts.length >= 1);
});

test('getDailyCustomerSummary aggregates expected totals and flags mismatches', async () => {
  const provider = new MockBankEscrowProvider({
    'CUST-101': {
      balance: 1325,
      transactions: [
        { id: 'txn-1', customerId: 'CUST-101', date: '2026-09-12', type: 'CREDIT', amount: 1500, description: 'Escrow inflow' },
        { id: 'txn-2', customerId: 'CUST-101', date: '2026-09-12', type: 'DEBIT', amount: 250, description: 'Fee deduction' },
        { id: 'txn-3', customerId: 'CUST-101', date: '2026-09-12', type: 'CREDIT', amount: 75, description: 'Adjustment' },
      ],
    },
  });

  const service = new EscrowIntelligenceService(provider);
  service.setExpectedTransactions('CUST-101', [
    { id: 'txn-101-1', customerId: 'CUST-101', date: '2026-09-12', type: 'CREDIT', amount: 1500, description: 'Escrow inflow' },
    { id: 'txn-101-2', customerId: 'CUST-101', date: '2026-09-12', type: 'DEBIT', amount: 250, description: 'Fee deduction' },
    { id: 'txn-101-3', customerId: 'CUST-101', date: '2026-09-12', type: 'CREDIT', amount: 75, description: 'Adjustment' },
  ]);

  const summary = await service.getDailyCustomerSummary('CUST-101', new Date('2026-09-12'));

  assert.equal(summary.expectedBalance, 1325);
  assert.equal(summary.netMovement, 1325);
  assert.equal(summary.transactionCount, 3);
  assert.equal(summary.mismatch, false);
});
