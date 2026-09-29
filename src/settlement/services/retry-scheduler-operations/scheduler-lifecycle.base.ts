import { OnModuleInit } from '@nestjs/common';
import { RetrySchedulerContextBase } from './scheduler-context.base';

export abstract class RetrySchedulerLifecycleBase extends RetrySchedulerContextBase implements OnModuleInit {
  onModuleInit() {
    this.startRetryScheduler();
  }

  protected startRetryScheduler() {
    this.logger.log('[RETRY_SCHEDULER] Starting B2B payout retry scheduler', {
      interval: this.RETRY_CHECK_INTERVAL_MS,
      batchSize: this.RETRY_BATCH_SIZE,
    });
    this.retryJobHandle = setInterval(() => {
      this.processRetries().catch((error) => {
        this.logger.error('[RETRY_SCHEDULER] Error during retry processing', {
          error: error instanceof Error ? error.message : String(error),
          stack: error instanceof Error ? error.stack : undefined,
        });
      });
    }, this.RETRY_CHECK_INTERVAL_MS);
    this.processRetries().catch((error) => {
      this.logger.error('[RETRY_SCHEDULER] Error during initial retry processing', {
        error: error instanceof Error ? error.message : String(error),
      });
    });
  }

  stopRetryScheduler() {
    if (this.retryJobHandle) {
      clearInterval(this.retryJobHandle);
      this.retryJobHandle = null;
      this.logger.log('[RETRY_SCHEDULER] Stopped B2B payout retry scheduler');
    }
  }
}
