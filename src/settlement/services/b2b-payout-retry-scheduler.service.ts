import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { B2BPayoutRetryService } from './b2b-payout-retry.service';
import { B2BPayoutIdempotencyService } from './b2b-payout-idempotency.service';
import { SettlementService } from '../settlement.service';
import { RetrySchedulerControlsBase } from './retry-scheduler-operations/scheduler-controls.base';

@Injectable()
export class B2BPayoutRetryScheduler extends RetrySchedulerControlsBase implements OnModuleInit {
  protected readonly logger = new Logger(B2BPayoutRetryScheduler.name);
  protected retryJobHandle: NodeJS.Timeout | null = null;
  protected isRunning = false;
  protected readonly RETRY_CHECK_INTERVAL_MS = 30000;
  protected readonly RETRY_BATCH_SIZE = 10;

  constructor(
    protected readonly retryService: B2BPayoutRetryService,
    protected readonly idempotencyService: B2BPayoutIdempotencyService,
    protected readonly settlementService: SettlementService,
  ) {
    super();
  }
}
