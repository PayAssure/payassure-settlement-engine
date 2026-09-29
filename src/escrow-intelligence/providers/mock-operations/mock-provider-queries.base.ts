import type { BankEscrowBalanceSnapshot, EscrowTransactionRecord } from '../../escrow-intelligence.types';
import { MockProviderPersistenceBase } from './mock-provider-persistence.base';

export abstract class MockProviderQueriesBase extends MockProviderPersistenceBase {
  async getCustomerEscrowBalance(customerId: string, asOfDate?: Date): Promise<BankEscrowBalanceSnapshot> {
    try {
      const account = await this.prisma.mockBankEscrowAccount.findUnique({ where: { customerId } });
      if (account) {
        return {
          customerId,
          balance: Number(account.balance.toString()),
          currency: account.currency,
          asOf: account.updatedAt ?? asOfDate ?? new Date(),
          source: 'mock-bank-api',
        };
      }
    } catch (error) {
    }

    const account = this.accounts.get(customerId) ?? { balance: 0, transactions: [], currency: 'KES', asOf: asOfDate ?? new Date() };
    return {
      customerId,
      balance: Number(account.balance ?? 0),
      currency: account.currency ?? 'KES',
      asOf: account.asOf ?? asOfDate ?? new Date(),
      source: 'mock-bank-api',
    };
  }

  async getCustomerEscrowTransactions(customerId: string, asOfDate?: Date): Promise<EscrowTransactionRecord[]> {
    try {
      const rows = await this.prisma.mockBankEscrowTransaction.findMany({
        where: { customerId },
        orderBy: { createdAt: 'desc' },
      });

      if (rows.length > 0) {
        return rows.map((row) => ({
          id: row.id,
          customerId: row.customerId,
          date: row.createdAt.toISOString().slice(0, 10),
          type: String(row.type ?? 'CREDIT'),
          amount: Number(row.amount.toString()),
          description: row.description ?? 'Escrow ledger movement',
        }));
      }
    } catch (error) {
    }

    const account = this.accounts.get(customerId) ?? { transactions: [] };
    const date = asOfDate ? asOfDate.toISOString().slice(0, 10) : undefined;
    return (account.transactions ?? []).filter((transaction) => !date || transaction.date === date);
  }
}
