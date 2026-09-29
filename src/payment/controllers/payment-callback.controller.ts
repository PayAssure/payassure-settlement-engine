import { Controller, Logger } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { SettlementService } from '../../settlement/settlement.service';
import { MpesaCallbackHandlersBase } from './callback-operations/mpesa-callback-handlers.base';

@ApiTags('Payments')
@Controller('payments')
export class PaymentCallbackController extends MpesaCallbackHandlersBase {
  protected readonly logger = new Logger(PaymentCallbackController.name);

  constructor(protected readonly settlementService: SettlementService) {
    super();
  }
}
