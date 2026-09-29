import { Controller } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { EscrowIntelligenceService } from './escrow-intelligence.service';
import { MockBankEscrowProvider } from './providers/mock-bank-escrow.provider';
import { MockScenarioControllerBase } from './controller-operations/mock-scenario.controller.base';

@ApiTags('escrow')
@Controller('escrow')
export class EscrowIntelligenceController extends MockScenarioControllerBase {
  constructor(
    protected readonly escrowIntelligenceService: EscrowIntelligenceService,
    protected readonly mockBankEscrowProvider: MockBankEscrowProvider,
  ) {
    super();
  }
}
