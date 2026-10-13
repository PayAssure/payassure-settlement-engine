import { Module } from '@nestjs/common';
import { BANK_ESCROW_PROVIDER } from './escrow-intelligence.constants';
import { EscrowIntelligenceController } from './escrow-intelligence.controller';
import { EscrowIntelligenceService } from './escrow-intelligence.service';
import { MockBankEscrowProvider } from './providers/mock-bank-escrow.provider';
import { RetailerEscrowReconciliationScheduler } from '../retailer/services/reconciliation/retailer-escrow-reconciliation-scheduler.service';

@Module({
  controllers: [EscrowIntelligenceController],
  providers: [
    MockBankEscrowProvider,
    {
      provide: BANK_ESCROW_PROVIDER,
      useExisting: MockBankEscrowProvider,
    },
    EscrowIntelligenceService,
    RetailerEscrowReconciliationScheduler,
  ],
  exports: [EscrowIntelligenceService, MockBankEscrowProvider],
})
export class EscrowIntelligenceModule {}
