import { Prisma } from '@prisma/client';
import type { EscrowTransactionRecord } from '../../escrow-intelligence.types';
import { MockProviderCollectionBase } from './mock-provider-collection.base';

export abstract class MockProviderSeedingBase extends MockProviderCollectionBase {
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
}
