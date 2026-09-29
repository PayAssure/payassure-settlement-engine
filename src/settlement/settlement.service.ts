import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { SettlementRepository } from './settlement.repository';
import { B2BPayoutIdempotencyService } from './services/b2b-payout-idempotency.service';
import { B2BPayoutRetryService } from './services/b2b-payout-retry.service';
import { SettlementServiceLifecycleBase } from './service-operations/lifecycle.base';

@Injectable()
export class SettlementService extends SettlementServiceLifecycleBase implements OnModuleDestroy {
  protected readonly prisma = new PrismaClient();
  protected readonly logger = new Logger(SettlementService.name);
  protected readonly TOKEN_EXPIRY = 3600;
  protected readonly SUPPORTED_CURRENCIES = ['KES', 'USD', 'TZS'];

  constructor(
    protected readonly repository: SettlementRepository,
    protected readonly idempotencyService: B2BPayoutIdempotencyService,
    protected readonly retryService: B2BPayoutRetryService,
  ) {
    super();
  }
}
