import { Prisma, PrismaClient } from '@prisma/client';
import { BankEscrowProvider, MockCollectionResult } from './bank-escrow-provider.interface';
import { BankEscrowBalanceSnapshot, EscrowProviderType, EscrowTransactionRecord, MockEscrowScenario } from '../escrow-intelligence.types';

export class MockBankEscrowProvider implements BankEscrowProvider {
  private readonly prisma = new PrismaClient();
  private readonly accounts = new Map<string, { balance: number; transactions: EscrowTransactionRecord[]; currency?: string; asOf?: Date }>();
  private failureMode: 'none' | 'provider-down' | 'mismatch' | 'duplicate' | 'reversal' = 'none';
  private readonly auditLogs: Array<Record<string, any>> = [];

  constructor(initialState: Record<string, { balance: number; transactions?: EscrowTransactionRecord[]; currency?: string; asOf?: Date } > = {}) {
    for (const [customerId, snapshot] of Object.entries(initialState)) {
      this.accounts.set(customerId, {
        balance: Number(snapshot.balance ?? 0),
        transactions: Array.isArray(snapshot.transactions) ? snapshot.transactions : [],
        currency: snapshot.currency ?? 'KES',
        asOf: snapshot.asOf ?? new Date(),
      });
    }
  }

  private async persistCollectionToDatabase(payload: {
    customerId: string;
    amount: number;
    provider: EscrowProviderType;
    scenario?: MockEscrowScenario;
    description?: string;
  }): Promise<MockCollectionResult | null> {
    try {
      const inMemorySnapshot = this.accounts.get(payload.customerId) ?? { balance: 0, transactions: [], currency: 'KES', asOf: new Date() };
      const inMemoryBalance = Number(inMemorySnapshot.balance ?? 0);
      const account = await this.prisma.mockBankEscrowAccount.upsert({
        where: { customerId: payload.customerId },
        update: {},
        create: {
          customerId: payload.customerId,
          merchantId: payload.customerId,
          currency: 'KES',
          balance: new Prisma.Decimal(inMemoryBalance),
          status: 'ACTIVE',
          accountType: 'RETAILER_ESCROW',
          notes: 'Persisted mock escrow balance',
        },
      });

      const currentBalance = Number(account.balance.toString());
      const amount = Number(payload.amount ?? 0);

      if (currentBalance < amount) {
        return {
          status: 'BLOCKED',
          provider: payload.provider ?? 'CASH',
          scenario: payload.scenario ?? 'cash-collection',
          expectedBalance: currentBalance,
          actualBalance: currentBalance,
          collectedAmount: 0,
          message: `Insufficient retailer escrow balance. Available: ${currentBalance} KES. Required: ${amount} KES. Deposit funds into the escrow account before retrying the settlement.`,
          auditLogId: account.id,
        };
      }

      const nextBalance = Math.max(0, currentBalance - amount);

      await this.prisma.mockBankEscrowAccount.update({
        where: { id: account.id },
        data: { balance: new Prisma.Decimal(nextBalance), updatedAt: new Date() },
      });

      const transaction = await this.prisma.mockBankEscrowTransaction.create({
        data: {
          accountId: account.id,
          customerId: payload.customerId,
          type: 'DEBIT',
          amount: new Prisma.Decimal(amount),
          balanceAfter: new Prisma.Decimal(nextBalance),
          provider: String(payload.provider ?? 'CASH'),
          scenario: payload.scenario ?? 'cash-collection',
          description: payload.description ?? 'Cash collection from retailer escrow',
        },
      });

      return {
        status: 'SUCCESS',
        provider: payload.provider ?? 'CASH',
        scenario: payload.scenario ?? 'cash-collection',
        expectedBalance: currentBalance,
        actualBalance: nextBalance,
        collectedAmount: amount,
        message: 'Mock escrow collection succeeded and database state was updated.',
        auditLogId: transaction.id,
      };
    } catch (error) {
      return null;
    }
  }

  async refundCollection(payload: {
    customerId: string;
    amount: number;
    provider: EscrowProviderType;
    scenario?: MockEscrowScenario;
    description?: string;
  }): Promise<MockCollectionResult> {
    try {
      const inMemorySnapshot = this.accounts.get(payload.customerId) ?? { balance: 0, transactions: [], currency: 'KES', asOf: new Date() };
      const inMemoryBalance = Number(inMemorySnapshot.balance ?? 0);
      const account = await this.prisma.mockBankEscrowAccount.upsert({
        where: { customerId: payload.customerId },
        update: {},
        create: {
          customerId: payload.customerId,
          merchantId: payload.customerId,
          currency: 'KES',
          balance: new Prisma.Decimal(inMemoryBalance),
          status: 'ACTIVE',
          accountType: 'RETAILER_ESCROW',
          notes: 'Persisted mock escrow balance',
        },
      });

      const currentBalance = Number(account.balance.toString());
      const amount = Number(payload.amount ?? 0);
      const nextBalance = currentBalance + amount;

      await this.prisma.mockBankEscrowAccount.update({
        where: { id: account.id },
        data: { balance: new Prisma.Decimal(nextBalance), updatedAt: new Date() },
      });

      const transaction = await this.prisma.mockBankEscrowTransaction.create({
        data: {
          accountId: account.id,
          customerId: payload.customerId,
          type: 'CREDIT',
          amount: new Prisma.Decimal(amount),
          balanceAfter: new Prisma.Decimal(nextBalance),
          provider: String(payload.provider ?? 'CASH'),
          scenario: payload.scenario ?? 'cash-refund',
          description: payload.description ?? 'Escrow refund after failed mixed settlement funding',
        },
      });

      return {
        status: 'SUCCESS',
        provider: payload.provider ?? 'CASH',
        scenario: payload.scenario ?? 'cash-refund',
        expectedBalance: currentBalance,
        actualBalance: nextBalance,
        collectedAmount: amount,
        message: 'Escrow funds were refunded after the MPESA funding attempt failed.',
        auditLogId: transaction.id,
      };
    } catch (error) {
      const account = this.accounts.get(payload.customerId) ?? { balance: 0, transactions: [], currency: 'KES', asOf: new Date() };
      const currentBalance = Number(account.balance ?? 0);
      const nextBalance = currentBalance + Number(payload.amount ?? 0);
      const refundTransaction: EscrowTransactionRecord = {
        id: `escrow-refund-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        customerId: payload.customerId,
        date: new Date().toISOString().slice(0, 10),
        type: 'CREDIT',
        amount: Number(payload.amount ?? 0),
        description: payload.description ?? 'Escrow refund after failed mixed settlement funding',
      };

      this.accounts.set(payload.customerId, {
        balance: nextBalance,
        transactions: [...(account.transactions ?? []), refundTransaction],
        currency: account.currency ?? 'KES',
        asOf: new Date(),
      });

      return {
        status: 'SUCCESS',
        provider: payload.provider ?? 'CASH',
        scenario: payload.scenario ?? 'cash-refund',
        expectedBalance: currentBalance,
        actualBalance: nextBalance,
        collectedAmount: Number(payload.amount ?? 0),
        message: 'Escrow funds were refunded after the MPESA funding attempt failed.',
        auditLogId: refundTransaction.id,
      };
    }
  }

  setFailureMode(mode: 'none' | 'provider-down' | 'mismatch' | 'duplicate' | 'reversal'): void {
    this.failureMode = mode;
  }

  getAuditLogs(): Array<Record<string, any>> {
    return [...this.auditLogs];
  }

  async simulateCollection(payload: {
    customerId: string;
    amount: number;
    provider: EscrowProviderType;
    scenario?: MockEscrowScenario;
    supplierAmount?: number;
    platformFee?: number;
    retailerEscrowBalance?: number;
  }): Promise<MockCollectionResult> {
    const scenario = payload.scenario ?? 'success';
    const provider = payload.provider ?? 'MPESA';
    const recipientAmount = Number(payload.supplierAmount ?? payload.amount ?? 0);
    const retainedFee = Number(payload.platformFee ?? 0);
    const expectedBalance = Number(payload.retailerEscrowBalance ?? 0);
    const actualBalance = provider === 'CASH' ? expectedBalance : Math.max(0, expectedBalance - recipientAmount - retainedFee);

    const logEntry = {
      id: `audit-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      customerId: payload.customerId,
      provider,
      scenario,
      amount: Number(payload.amount ?? 0),
      expectedBalance,
      actualBalance,
      supplierAmount: recipientAmount,
      retainedFee,
      status: 'RECORDED',
      createdAt: new Date().toISOString(),
    };

    this.auditLogs.push(logEntry);

    if (this.failureMode === 'provider-down' || scenario === 'provider-down') {
      return {
        status: 'FAILED',
        provider,
        scenario,
        expectedBalance,
        actualBalance,
        collectedAmount: 0,
        message: `Mock ${provider} provider is down. Settlement blocked.`,
        auditLogId: logEntry.id,
      };
    }

    if (this.failureMode === 'duplicate' || scenario === 'duplicate') {
      return {
        status: 'BLOCKED',
        provider,
        scenario,
        expectedBalance,
        actualBalance,
        collectedAmount: 0,
        message: 'Duplicate transaction detected; settlement requires a new unique reference.',
        auditLogId: logEntry.id,
      };
    }

    if (this.failureMode === 'reversal' || scenario === 'reversal') {
      return {
        status: 'BLOCKED',
        provider,
        scenario,
        expectedBalance,
        actualBalance,
        collectedAmount: 0,
        message: 'Mock reversal detected; all funds remain in escrow pending review.',
        auditLogId: logEntry.id,
      };
    }

    if (this.failureMode === 'mismatch' || scenario === 'mismatch') {
      return {
        status: 'BLOCKED',
        provider,
        scenario,
        expectedBalance,
        actualBalance: Math.max(0, actualBalance - 100),
        collectedAmount: 0,
        message: 'Escrow balance mismatch: expected balance does not match actual bank balance.',
        auditLogId: logEntry.id,
      };
    }

    if (provider === 'CASH' || scenario === 'cash-collection') {
      const currentBalance = await this.getCustomerEscrowBalance(payload.customerId);
      const requiredAmount = Number(payload.amount ?? 0);

      if (Number(currentBalance.balance ?? 0) < requiredAmount) {
        return {
          status: 'BLOCKED',
          provider,
          scenario,
          expectedBalance: Number(currentBalance.balance ?? 0),
          actualBalance: Number(currentBalance.balance ?? 0),
          collectedAmount: 0,
          message: `Insufficient retailer escrow balance. Available: ${Number(currentBalance.balance ?? 0)} KES. Required: ${requiredAmount} KES. Deposit funds into the escrow account before retrying the settlement.`,
          auditLogId: logEntry.id,
        };
      }

      const persisted = await this.persistCollectionToDatabase({
        customerId: payload.customerId,
        amount: Number(payload.amount ?? 0),
        provider,
        scenario,
        description: 'Cash collection from retailer escrow for supplier payout',
      });

      if (persisted) {
        return persisted;
      }
    }

    return {
      status: 'SUCCESS',
      provider,
      scenario,
      expectedBalance,
      actualBalance,
      collectedAmount: Number(payload.amount ?? 0),
      message: `Mock ${provider} collection succeeded and settlement can proceed.`,
      auditLogId: logEntry.id,
    };
  }

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
      // fall through to in-memory account lookup below
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
      // fall through to in-memory account lookup below
    }

    const account = this.accounts.get(customerId) ?? { transactions: [] };
    const date = asOfDate ? asOfDate.toISOString().slice(0, 10) : undefined;

    return (account.transactions ?? []).filter((transaction) => {
      if (!date) return true;
      return transaction.date === date;
    });
  }

  async seedAccount(customerId: string, balance: number, currency = 'KES', metadata?: Record<string, any>): Promise<{
    customerId: string;
    balance: number;
    currency: string;
    transaction: EscrowTransactionRecord;
    metadata?: Record<string, any>;
  }> {
    const normalizedCustomerId = String(customerId ?? 'CUST-MOCK');
    const normalizedBalance = Number(balance ?? 0);

    try {
      const account = await this.prisma.mockBankEscrowAccount.upsert({
        where: { customerId: normalizedCustomerId },
        update: {
          customerEmail: metadata?.email ?? undefined,
          merchantId: metadata?.merchantId ?? normalizedCustomerId,
          currency,
          notes: metadata?.description ?? 'Mock escrow account seeded',
        },
        create: {
          customerId: normalizedCustomerId,
          merchantId: metadata?.merchantId ?? normalizedCustomerId,
          customerEmail: metadata?.email ?? null,
          currency,
          balance: new Prisma.Decimal(normalizedBalance),
          status: 'ACTIVE',
          accountType: 'RETAILER_ESCROW',
          notes: metadata?.description ?? 'Mock escrow account seeded',
        },
      });

      const existingBalance = Number(account.balance.toString());
      const nextBalance = existingBalance + normalizedBalance;
      await this.prisma.mockBankEscrowAccount.update({
        where: { id: account.id },
        data: { balance: new Prisma.Decimal(nextBalance) },
      });

      const transaction = await this.prisma.mockBankEscrowTransaction.create({
        data: {
          accountId: account.id,
          customerId: normalizedCustomerId,
          type: 'DEPOSIT',
          amount: new Prisma.Decimal(normalizedBalance),
          balanceAfter: new Prisma.Decimal(nextBalance),
          provider: 'SEED',
          scenario: 'seed',
          description: metadata?.description ?? 'Mock escrow account seeded for retailer',
        },
      });

      return {
        customerId: normalizedCustomerId,
        balance: nextBalance,
        currency,
        transaction: {
          id: transaction.id,
          customerId: normalizedCustomerId,
          date: transaction.createdAt.toISOString().slice(0, 10),
          type: 'DEPOSIT',
          amount: Number(transaction.amount.toString()),
          description: transaction.description ?? 'Mock escrow account seeded',
        },
        metadata,
      };
    } catch (error) {
      // Fallback to in-memory seed behavior
    }

    const existing = this.accounts.get(normalizedCustomerId) ?? { balance: 0, transactions: [], currency, asOf: new Date() };
    const nextBalance = Number(existing.balance ?? 0) + normalizedBalance;
    const transaction: EscrowTransactionRecord = {
      id: `escrow-seed-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      customerId: normalizedCustomerId,
      date: new Date().toISOString().slice(0, 10),
      type: 'DEPOSIT',
      amount: normalizedBalance,
      description: metadata?.description ?? 'Mock escrow account seeded for retailer',
    };

    this.accounts.set(normalizedCustomerId, {
      balance: nextBalance,
      transactions: [...(existing.transactions ?? []), transaction],
      currency: currency ?? existing.currency ?? 'KES',
      asOf: new Date(),
    });

    return {
      customerId: normalizedCustomerId,
      balance: nextBalance,
      currency: currency ?? existing.currency ?? 'KES',
      transaction,
      metadata,
    };
  }

  getProviderName(): string {
    return 'MockBankEscrowProvider';
  }
}
