import { Module } from '@nestjs/common';
import { BANK_ESCROW_PROVIDER } from './escrow-intelligence.constants';
import { EscrowIntelligenceController } from './escrow-intelligence.controller';
import { EscrowIntelligenceService } from './escrow-intelligence.service';
import { MockBankEscrowProvider } from './providers/mock-bank-escrow.provider';

@Module({
  controllers: [EscrowIntelligenceController],
  providers: [
    MockBankEscrowProvider,
    {
      provide: BANK_ESCROW_PROVIDER,
      useExisting: MockBankEscrowProvider,
    },
    EscrowIntelligenceService,
  ],
  exports: [EscrowIntelligenceService, MockBankEscrowProvider],
})
export class EscrowIntelligenceModule {}
