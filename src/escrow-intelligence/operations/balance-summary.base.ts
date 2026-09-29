import { EscrowExpectedTransactionsBase } from './expected-transactions.base';
import type { DailyEscrowSummary, EscrowTransactionRecord } from '../escrow-intelligence.types';

export abstract class EscrowBalanceSummaryBase extends EscrowExpectedTransactionsBase {
  protected normalizeSignedAmount(type: string, amount: number): number {
    const normalizedType = String(type ?? '').toUpperCase();

    if (['CREDIT', 'DEPOSIT', 'REFUND', 'INCREASE', 'REVENUE'].includes(normalizedType)) {
      return Number(amount ?? 0);
    }

    if (['DEBIT', 'WITHDRAWAL', 'SETTLEMENT', 'PAYOUT', 'FEE', 'EXPENSE', 'PAYMENT'].includes(normalizedType)) {
      return -Math.abs(Number(amount ?? 0));
    }

    if (normalizedType === 'ADJUSTMENT') {
      return Number(amount ?? 0);
    }

    return Number(amount ?? 0);
  }

  calculateExpectedBalance(customerId: string, asOfDate?: Date, transactionsOverride?: EscrowTransactionRecord[]): number {
    const transactions = transactionsOverride ?? this.getExpectedTransactions(customerId, asOfDate);
    return transactions.reduce((sum, transaction) => sum + this.normalizeSignedAmount(transaction.type, Number(transaction.amount ?? 0)), 0);
  }

  async getDailyCustomerSummary(customerId: string, asOfDate = new Date()): Promise<DailyEscrowSummary> {
    const targetDate = asOfDate.toISOString().slice(0, 10);
    const expectedTransactions = this.getExpectedTransactions(customerId, asOfDate);
    const expectedBalance = this.calculateExpectedBalance(customerId, asOfDate, expectedTransactions);
    const actualBalanceSnapshot = await this.bankProvider.getCustomerEscrowBalance(customerId, asOfDate);
    const providerTransactions = await this.bankProvider.getCustomerEscrowTransactions(customerId, asOfDate);
    const actualBalance = Number(actualBalanceSnapshot.balance ?? 0);
    const delta = actualBalance - expectedBalance;
    const mismatch = Math.abs(delta) > 0;
    const alerts: string[] = [];

    if (mismatch) {
      alerts.push(`Escrow mismatch detected for customer ${customerId}: expected ${expectedBalance}, actual ${actualBalance}. Delta=${delta}`);
    }

    if (!providerTransactions.length && expectedTransactions.length > 0) {
      alerts.push(`Bank API returned no transactions for customer ${customerId} on ${targetDate}`);
    }

    const summary: DailyEscrowSummary = {
      customerId,
      date: targetDate,
      expectedBalance,
      actualBalance,
      delta,
      netMovement: expectedBalance,
      transactionCount: expectedTransactions.length,
      mismatch,
      alerts,
      blocked: mismatch,
      provider: this.bankProvider.getProviderName(),
    };

    this.logger.log(`Escrow summary for ${customerId} on ${targetDate}: expected=${expectedBalance}, actual=${actualBalance}, delta=${delta}`);
    return summary;
  }
}
