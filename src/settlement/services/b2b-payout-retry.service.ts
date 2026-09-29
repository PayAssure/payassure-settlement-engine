import { Injectable, Logger } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { B2BPayoutIdempotencyService } from './b2b-payout-idempotency.service';
import { RetryLifecycleBase } from './retry-operations/lifecycle.base';
import type { RetryPolicy } from './retry-operations/types';

export type { RetryPolicy, RetrySchedule } from './retry-operations/types';

@Injectable()
export class B2BPayoutRetryService extends RetryLifecycleBase {
  protected readonly prisma = new PrismaClient();
  protected readonly logger = new Logger(B2BPayoutRetryService.name);
  protected readonly defaultRetryPolicy: RetryPolicy = {
    maxRetries: 5,
    initialDelayMs: 60000,
    maxDelayMs: 3600000,
    backoffMultiplier: 2.0,
  };

  constructor(protected readonly idempotencyService: B2BPayoutIdempotencyService) {
    super();
  }
}
