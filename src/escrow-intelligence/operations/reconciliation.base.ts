import { EscrowBalanceSummaryBase } from './balance-summary.base';
import type { EscrowReconciliationResult, EscrowTransactionRecord } from '../escrow-intelligence.types';

export abstract class EscrowReconciliationBase extends EscrowBalanceSummaryBase {
  async reconcileEscrow(customerId: string, asOfDate = new Date()): Promise<EscrowReconciliationResult> {
    const targetDate = asOfDate.toISOString().slice(0, 10);
    const expectedTransactions = this.getExpectedTransactions(customerId, asOfDate);
    const expectedBalance = this.calculateExpectedBalance(customerId, asOfDate, expectedTransactions);

    let actualBalance = 0;
    let providerTransactions: EscrowTransactionRecord[] = [];
    const alerts: string[] = [];

    try {
      const snapshot = await this.bankProvider.getCustomerEscrowBalance(customerId, asOfDate);
      actualBalance = Number(snapshot.balance ?? 0);
      providerTransactions = await this.bankProvider.getCustomerEscrowTransactions(customerId, asOfDate);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown bank provider error';
      this.logger.error(`Escrow reconciliation failed for ${customerId}: ${message}`);
      const result: EscrowReconciliationResult = {
        customerId,
        date: targetDate,
        status: 'ERROR',
        expectedBalance,
        actualBalance: 0,
        delta: 0 - expectedBalance,
        transactionCount: expectedTransactions.length,
        blockedSettlement: true,
        alerts: [`Failed to query bank provider: ${message}`],
        provider: this.bankProvider.getProviderName(),
        reconciledAt: new Date().toISOString(),
      };
      this.reconciliationHistory.push(result);
      return result;
    }

    const delta = actualBalance - expectedBalance;
    const hasMismatch = Math.abs(delta) > 0;
    const hasMissingBankData = !providerTransactions.length && expectedTransactions.length > 0;

    if (hasMismatch) {
      alerts.push(`Escrow mismatch for ${customerId}: expected ${expectedBalance}, actual ${actualBalance} (delta=${delta})`);
    }

    if (hasMissingBankData) {
      alerts.push(`Bank provider returned no transaction data for ${customerId} on ${targetDate}`);
    }

    if (alerts.length === 0 && expectedTransactions.length === 0) {
      alerts.push(`No expected escrow transactions recorded for ${customerId} on ${targetDate}`);
    }

    const blockedSettlement = hasMismatch || hasMissingBankData || expectedTransactions.length === 0;
    const status: EscrowReconciliationResult['status'] = blockedSettlement ? 'BLOCKED' : 'MATCHED';

    const result: EscrowReconciliationResult = {
      customerId,
      date: targetDate,
      status,
      expectedBalance,
      actualBalance,
      delta,
      transactionCount: expectedTransactions.length,
      blockedSettlement,
      alerts,
      provider: this.bankProvider.getProviderName(),
      reconciledAt: new Date().toISOString(),
    };

    this.reconciliationHistory.push(result);

    if (blockedSettlement) {
      this.logger.warn(`Escrow reconciliation blocked for ${customerId} on ${targetDate}: ${alerts.join('; ')}`);
    } else {
      this.logger.log(`Escrow reconciliation matched for ${customerId} on ${targetDate}`);
    }

    return result;
  }

  async ensureSettlementReady(customerId: string, asOfDate = new Date()): Promise<EscrowReconciliationResult> {
    const result = await this.reconcileEscrow(customerId, asOfDate);
    if (result.blockedSettlement) {
      throw new Error(`Settlement blocked for customer ${customerId}: ${result.alerts.join('; ')}`);
    }
    return result;
  }
}
