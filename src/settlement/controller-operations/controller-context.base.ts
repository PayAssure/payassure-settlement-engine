import type { Logger } from '@nestjs/common';
import type { SettlementService } from '../settlement.service';

export abstract class SettlementControllerContextBase {
  protected abstract readonly logger: Logger;
  protected abstract readonly settlementService: SettlementService;
}
