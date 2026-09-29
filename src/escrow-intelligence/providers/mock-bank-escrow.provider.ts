import { PrismaClient } from '@prisma/client';
import { BankEscrowProvider } from './bank-escrow-provider.interface';
import { EscrowTransactionRecord } from '../escrow-intelligence.types';
import { MockProviderSeedingBase } from './mock-operations/mock-provider-seeding.base';

export class MockBankEscrowProvider extends MockProviderSeedingBase implements BankEscrowProvider {
  protected readonly prisma = new PrismaClient();
  protected readonly accounts = new Map<string, { balance: number; transactions: EscrowTransactionRecord[]; currency?: string; asOf?: Date }>();
  protected failureMode: 'none' | 'provider-down' | 'mismatch' | 'duplicate' | 'reversal' = 'none';
  protected readonly auditLogs: Array<Record<string, any>> = [];

  constructor(initialState: Record<string, { balance: number; transactions?: EscrowTransactionRecord[]; currency?: string; asOf?: Date }> = {}) {
    super();
    for (const [customerId, snapshot] of Object.entries(initialState)) {
      this.accounts.set(customerId, {
        balance: Number(snapshot.balance ?? 0),
        transactions: Array.isArray(snapshot.transactions) ? snapshot.transactions : [],
        currency: snapshot.currency ?? 'KES',
        asOf: snapshot.asOf ?? new Date(),
      });
    }
  }
}
