import { EscrowContextBase } from './escrow-context.base';
import type { EscrowTransactionRecord } from '../escrow-intelligence.types';

export abstract class EscrowExpectedTransactionsBase extends EscrowContextBase {
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
}
