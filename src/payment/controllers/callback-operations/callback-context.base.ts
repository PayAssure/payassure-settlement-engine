import type { Logger } from '@nestjs/common';
import type { SettlementService } from '../../../settlement/settlement.service';

export abstract class CallbackContextBase {
  protected abstract readonly logger: Logger;
  protected abstract readonly settlementService: SettlementService;
}
