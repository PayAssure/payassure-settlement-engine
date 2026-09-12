import { Inject, Injectable, Logger } from '@nestjs/common';
import { BANK_ESCROW_PROVIDER } from './escrow-intelligence.constants';
import { BankEscrowProvider } from './providers/bank-escrow-provider.interface';
import { DailyEscrowSummary, EscrowProviderType, EscrowReconciliationResult, EscrowTransactionRecord, MockEscrowScenario } from './escrow-intelligence.types';

@Injectable()
export class EscrowIntelligenceService {
  private readonly logger = new Logger(EscrowIntelligenceService.name);
  private readonly expectedTransactions = new Map<string, EscrowTransactionRecord[]>();
  private readonly reconciliationHistory: EscrowReconciliationResult[] = [];

  constructor(
    @Inject(BANK_ESCROW_PROVIDER)
    private readonly bankProvider: BankEscrowProvider,
  ) {}

  setExpectedTransactions(customerId: string, transactions: EscrowTransactionRecord[]): void {
    this.expectedTransactions.set(customerId, transactions.map((transaction) => ({ ...transaction })));
  }

  addExpectedTransaction(customerId: string, transaction: EscrowTransactionRecord): void {
    const existing = this.expectedTransactions.get(customerId) ?? [];
    this.expectedTransactions.set(customerId, [...existing, { ...transaction }]);
  }

  getExpectedTransactions(customerId: string, asOfDate?: Date): EscrowTransactionRecord[] {
    const targetDate = asOfDate ? asOfDate.toISOString().slice(0, 10) : undefined;
    const transactions = this.expectedTransactions.get(customerId) ?? [];
    if (!targetDate) return [...transactions];
    return transactions.filter((transaction) => transaction.date === targetDate);
  }

  calculateExpectedBalance(customerId: string, asOfDate?: Date, transactionsOverride?: EscrowTransactionRecord[]): number {
    const transactions = transactionsOverride ?? this.getExpectedTransactions(customerId, asOfDate);
    return transactions.reduce((sum, transaction) => sum + this.normalizeSignedAmount(transaction.type, Number(transaction.amount ?? 0)), 0);
  }

  private normalizeSignedAmount(type: string, amount: number): number {
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

  async simulateSettlementCollection(payload: {
    customerId: string;
    amount: number;
    provider: EscrowProviderType;
    scenario?: MockEscrowScenario;
    supplierAmount?: number;
    platformFee?: number;
    retailerEscrowBalance?: number;
    expectedTransactions?: EscrowTransactionRecord[];
  }): Promise<any> {
    const provider = String(payload.provider ?? 'MPESA').toUpperCase() as EscrowProviderType;
    const transactionList = payload.expectedTransactions ?? this.getExpectedTransactions(payload.customerId);
    const expectedBalance = this.calculateExpectedBalance(payload.customerId, undefined, transactionList);
    const actualBalance = Number(payload.retailerEscrowBalance ?? (await this.bankProvider.getCustomerEscrowBalance(payload.customerId)).balance ?? 0);
    const collection = await this.bankProvider.simulateCollection?.({
      customerId: payload.customerId,
      amount: Number(payload.amount ?? 0),
      provider,
      scenario: payload.scenario ?? 'success',
      supplierAmount: Number(payload.supplierAmount ?? payload.amount ?? 0),
      platformFee: Number(payload.platformFee ?? 0),
      retailerEscrowBalance: actualBalance,
    }) ?? {
      status: 'SUCCESS',
      provider,
      scenario: payload.scenario ?? 'success',
      expectedBalance,
      actualBalance,
      collectedAmount: Number(payload.amount ?? 0),
      message: 'Collection simulation successful',
    };

    const blocked = collection.status !== 'SUCCESS';
    return {
      provider,
      expectedBalance,
      actualBalance,
      collection,
      settlementStatus: blocked ? 'BLOCKED' : 'READY',
      auditLogs: this.bankProvider.getAuditLogs?.() ?? [],
      message: blocked ? 'Settlement blocked due to payment provider or escrow validation failure.' : 'Settlement collection validated and settlement can proceed.',
    };
  }

  getReconciliationHistory(): EscrowReconciliationResult[] {
    return [...this.reconciliationHistory];
  }
}
