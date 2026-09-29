import type { Logger } from '@nestjs/common';
import type { OnbordingsService } from '../onbordings.service';

export abstract class OnbordingsControllerContextBase {
  protected abstract readonly logger: Logger;
  protected abstract readonly service: OnbordingsService;
}
