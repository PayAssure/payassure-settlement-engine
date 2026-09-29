import { Prisma } from '@prisma/client';
import type { EscrowProviderType, EscrowTransactionRecord, MockEscrowScenario } from '../../escrow-intelligence.types';
import type { MockCollectionResult } from '../bank-escrow-provider.interface';
import { MockProviderContextBase } from './mock-provider-context.base';

export abstract class MockProviderPersistenceBase extends MockProviderContextBase {
  protected async persistCollectionToDatabase(payload: {
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
}
