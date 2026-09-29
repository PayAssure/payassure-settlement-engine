import type { Logger } from '@nestjs/common';
import type { B2BPayoutRetryService } from '../b2b-payout-retry.service';
import type { B2BPayoutIdempotencyService } from '../b2b-payout-idempotency.service';
import type { SettlementService } from '../../settlement.service';

export abstract class RetrySchedulerContextBase {
  protected abstract readonly logger: Logger;
  protected abstract retryJobHandle: NodeJS.Timeout | null;
  protected abstract isRunning: boolean;
  protected abstract readonly RETRY_CHECK_INTERVAL_MS: number;
  protected abstract readonly RETRY_BATCH_SIZE: number;
  protected abstract readonly retryService: B2BPayoutRetryService;
  protected abstract readonly idempotencyService: B2BPayoutIdempotencyService;
  protected abstract readonly settlementService: SettlementService;
  protected abstract processRetries(): Promise<void>;
}
