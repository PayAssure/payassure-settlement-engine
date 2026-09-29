import { RetryProcessingBase } from './retry-processing.base';

export abstract class RetrySchedulerControlsBase extends RetryProcessingBase {
  getStatus() {
    return {
      isRunning: this.isRunning,
      isScheduled: !!this.retryJobHandle,
      checkInterval: this.RETRY_CHECK_INTERVAL_MS,
      batchSize: this.RETRY_BATCH_SIZE,
    };
  }

  async manualRetryRun(): Promise<any> {
    return this.processRetries();
  }
}
