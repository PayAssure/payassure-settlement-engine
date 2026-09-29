import { RetrySchedulerLifecycleBase } from './scheduler-lifecycle.base';

export abstract class RetryProcessingBase extends RetrySchedulerLifecycleBase {
  protected async processRetries() {
    if (this.isRunning) {
      this.logger.debug('[RETRY_SCHEDULER] Retry processing already in progress, skipping');
      return;
    }
    this.isRunning = true;
    const startTime = Date.now();
    try {
      const pendingRetries = await this.idempotencyService.getPendingRetries();
      if (pendingRetries.length === 0) return;
      this.logger.log('[RETRY_SCHEDULER] Processing pending retries', {
        total: pendingRetries.length,
        batchSize: this.RETRY_BATCH_SIZE,
      });
      const batch = pendingRetries.slice(0, this.RETRY_BATCH_SIZE);
      const results = { success: 0, failed: 0, errors: [] as any[] };
      for (const payout of batch) {
        try {
          await this.retryPayout(payout);
          results.success++;
        } catch (error) {
          results.failed++;
          const errorMsg = error instanceof Error ? error.message : String(error);
          results.errors.push({ payoutReference: payout.payoutReference, idempotencyKey: payout.idempotencyKey, error: errorMsg });
          this.logger.error('[RETRY_SCHEDULER] Failed to retry payout', {
            payoutReference: payout.payoutReference,
            idempotencyKey: payout.idempotencyKey,
            attemptCount: payout.attemptCount,
            error: errorMsg,
          });
        }
      }
      const duration = Date.now() - startTime;
      this.logger.log('[RETRY_SCHEDULER] Batch processing completed', {
        batchSize: batch.length,
        success: results.success,
        failed: results.failed,
        durationMs: duration,
      });
      if (results.errors.length > 0) {
        this.logger.warn('[RETRY_SCHEDULER] Some retries failed', { errorCount: results.errors.length, errors: results.errors });
      }
    } finally {
      this.isRunning = false;
    }
  }

  protected async retryPayout(payout: any): Promise<void> {
    const dispatchResult = await this.settlementService.dispatchB2bPayouts({
      merchantTransactionReference: payout.merchantTransactionReference,
      party: payout.party,
      supplierMerchantId: payout.recipientMerchantId,
      amount: Number(payout.amount),
    });
    if (!dispatchResult.success) {
      await this.retryService.scheduleFailedPayoutForRetry(
        payout.idempotencyKey,
        `Gateway response: ${dispatchResult.gatewayResult?.responseDescription || 'Unknown error'}`,
      );
      throw new Error(`Payout dispatch failed: ${dispatchResult.gatewayResult?.error || 'Unknown error'}`);
    }
    this.logger.log('[RETRY_SCHEDULER] Successfully retried payout', {
      payoutReference: payout.payoutReference,
      idempotencyKey: payout.idempotencyKey,
      attemptCount: payout.attemptCount,
    });
  }
}
