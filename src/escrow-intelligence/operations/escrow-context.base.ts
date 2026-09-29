import type { Logger } from '@nestjs/common';
import type { BankEscrowProvider } from '../providers/bank-escrow-provider.interface';
import type { DailyEscrowSummary, EscrowReconciliationResult, EscrowTransactionRecord } from '../escrow-intelligence.types';

export abstract class EscrowContextBase {
  protected abstract readonly logger: Logger;
  protected abstract readonly bankProvider: BankEscrowProvider;
  protected abstract readonly expectedTransactions: Map<string, EscrowTransactionRecord[]>;
  protected abstract readonly reconciliationHistory: EscrowReconciliationResult[];
}
