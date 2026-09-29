import { Inject, Injectable, Logger } from '@nestjs/common';
import { BANK_ESCROW_PROVIDER } from './escrow-intelligence.constants';
import { BankEscrowProvider } from './providers/bank-escrow-provider.interface';
import { EscrowReconciliationResult, EscrowTransactionRecord } from './escrow-intelligence.types';
import { EscrowCollectionSimulationBase } from './operations/collection-simulation.base';

@Injectable()
export class EscrowIntelligenceService extends EscrowCollectionSimulationBase {
  protected readonly logger = new Logger(EscrowIntelligenceService.name);
  protected readonly expectedTransactions = new Map<string, EscrowTransactionRecord[]>();
  protected readonly reconciliationHistory: EscrowReconciliationResult[] = [];

  constructor(
    @Inject(BANK_ESCROW_PROVIDER)
    protected readonly bankProvider: BankEscrowProvider,
  ) {
    super();
  }
}
