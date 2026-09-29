import type { EscrowIntelligenceService } from '../escrow-intelligence.service';
import type { MockBankEscrowProvider } from '../providers/mock-bank-escrow.provider';

export abstract class EscrowControllerContextBase {
  protected abstract readonly escrowIntelligenceService: EscrowIntelligenceService;
  protected abstract readonly mockBankEscrowProvider: MockBankEscrowProvider;
}
