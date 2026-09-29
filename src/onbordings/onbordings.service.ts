import { Injectable, Logger, Optional } from '@nestjs/common';
import { EmailService } from './email.service';
import { OnbordingsRepository } from './onbordings.repository';
import { OnbordingsPaymentActivationBase } from './service-operations/payment-activation.base';

@Injectable()
export class OnbordingsService extends OnbordingsPaymentActivationBase {
  protected readonly logger = new Logger(OnbordingsService.name);

  constructor(
    protected readonly repository: OnbordingsRepository,
    @Optional() protected readonly emailService?: EmailService,
  ) {
    super();
  }
}
