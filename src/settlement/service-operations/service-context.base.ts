import type { Logger } from '@nestjs/common';
import type { PrismaClient } from '@prisma/client';
import type { SettlementRepository } from '../settlement.repository';
import type { B2BPayoutIdempotencyService } from '../services/b2b-payout-idempotency.service';
import type { B2BPayoutRetryService } from '../services/b2b-payout-retry.service';

export abstract class SettlementServiceContextBase {
  protected abstract readonly prisma: PrismaClient;
  protected abstract readonly logger: Logger;
  protected abstract readonly repository: SettlementRepository;
  protected abstract readonly idempotencyService: B2BPayoutIdempotencyService;
  protected abstract readonly retryService: B2BPayoutRetryService;
  protected abstract readonly TOKEN_EXPIRY: number;
  protected abstract readonly SUPPORTED_CURRENCIES: string[];
}
