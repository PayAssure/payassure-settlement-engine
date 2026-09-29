import { Controller, Logger } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { OnbordingsService } from './onbordings.service';
import { OnbordingsPaymentControllerBase } from './controller-operations/payment.controller.base';

@ApiTags('onbordings')
@Controller('onbordings')
export class OnbordingsController extends OnbordingsPaymentControllerBase {
  protected readonly logger = new Logger(OnbordingsController.name);

  constructor(protected readonly service: OnbordingsService) {
    super();
  }
}
