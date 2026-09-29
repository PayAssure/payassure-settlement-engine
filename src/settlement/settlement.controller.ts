import { Controller, Logger } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { SettlementService } from './settlement.service';
import { SettlementRetryControllerBase } from './controller-operations/retry.controller.base';

@ApiTags('Settlement')
@Controller('settlement')
export class SettlementController extends SettlementRetryControllerBase {
  protected readonly logger = new Logger(SettlementController.name);

  constructor(protected readonly settlementService: SettlementService) {
    super();
  }
}
