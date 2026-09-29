import { Injectable, Logger } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { PayoutIdempotencyLifecycleBase } from './idempotency-operations/lifecycle.base';

export type { CreatePayoutAttemptDto, PayoutAttemptResult } from './idempotency-operations/types';

@Injectable()
export class B2BPayoutIdempotencyService extends PayoutIdempotencyLifecycleBase {
  protected readonly prisma = new PrismaClient();
  protected readonly logger = new Logger(B2BPayoutIdempotencyService.name);
}
