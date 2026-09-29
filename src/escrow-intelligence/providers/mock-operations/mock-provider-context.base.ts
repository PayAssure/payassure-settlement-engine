import type { PrismaClient } from '@prisma/client';
import type { EscrowTransactionRecord } from '../../escrow-intelligence.types';

export abstract class MockProviderContextBase {
  protected abstract readonly prisma: PrismaClient;
  protected abstract readonly accounts: Map<string, { balance: number; transactions: EscrowTransactionRecord[]; currency?: string; asOf?: Date }>;
  protected abstract failureMode: 'none' | 'provider-down' | 'mismatch' | 'duplicate' | 'reversal';
  protected abstract readonly auditLogs: Array<Record<string, any>>;
}
