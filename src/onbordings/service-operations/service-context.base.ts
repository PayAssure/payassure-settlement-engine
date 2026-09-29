import type { Logger } from '@nestjs/common';
import type { EmailService } from '../email.service';
import type { OnbordingsRepository } from '../onbordings.repository';

export abstract class OnbordingsServiceContextBase {
  protected abstract readonly logger: Logger;
  protected abstract readonly repository: OnbordingsRepository;
  protected abstract readonly emailService?: EmailService;
}
