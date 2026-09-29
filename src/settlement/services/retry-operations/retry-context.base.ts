import type { Logger } from '@nestjs/common';
import type { PrismaClient } from '@prisma/client';
import type { B2BPayoutIdempotencyService } from '../b2b-payout-idempotency.service';
import type { RetryPolicy } from './types';

export abstract class RetryContextBase {
  protected abstract readonly prisma: PrismaClient;
  protected abstract readonly logger: Logger;
  protected abstract readonly idempotencyService: B2BPayoutIdempotencyService;
  protected abstract readonly defaultRetryPolicy: RetryPolicy;
}
