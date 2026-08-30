import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { B2BPayoutRetryService } from './b2b-payout-retry.service';
import { B2BPayoutIdempotencyService } from './b2b-payout-idempotency.service';
import { SettlementService } from '../settlement.service';

/**
 * B2BPayoutRetryScheduler is a scheduled job that runs periodically to retry failed payouts
 * It checks for payouts due for retry and re-dispatches them
 */
@Injectable()
export class B2BPayoutRetryScheduler implements OnModuleInit {
  private readonly logger = new Logger(B2BPayoutRetryScheduler.name);
  private retryJobHandle: NodeJS.Timeout | null = null;
  private isRunning = false;

  // Configuration
  private readonly RETRY_CHECK_INTERVAL_MS = 30000; // Check every 30 seconds
  private readonly RETRY_BATCH_SIZE = 10; // Process up to 10 retries per batch

  constructor(
    private readonly retryService: B2BPayoutRetryService,
    private readonly idempotencyService: B2BPayoutIdempotencyService,
    private readonly settlementService: SettlementService
  ) {}

  onModuleInit() {
    this.startRetryScheduler();
  }

  /**
   * Start the periodic retry scheduler
   */
  private startRetryScheduler() {
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

    // Process retries immediately on startup
    this.processRetries().catch((error) => {
      this.logger.error('[RETRY_SCHEDULER] Error during initial retry processing', {
        error: error instanceof Error ? error.message : String(error),
      });
    });
  }

  /**
   * Stop the retry scheduler
   */
  stopRetryScheduler() {
    if (this.retryJobHandle) {
      clearInterval(this.retryJobHandle);
      this.retryJobHandle = null;
      this.logger.log('[RETRY_SCHEDULER] Stopped B2B payout retry scheduler');
    }
  }

  /**
   * Process pending retries
   */
  private async processRetries() {
    if (this.isRunning) {
      this.logger.debug('[RETRY_SCHEDULER] Retry processing already in progress, skipping');
      return;
    }

    this.isRunning = true;
    const startTime = Date.now();

    try {
      const pendingRetries = await this.idempotencyService.getPendingRetries();

      if (pendingRetries.length === 0) {
        this.isRunning = false;
        return;
      }

      this.logger.log('[RETRY_SCHEDULER] Processing pending retries', {
        total: pendingRetries.length,
        batchSize: this.RETRY_BATCH_SIZE,
      });

      const batch = pendingRetries.slice(0, this.RETRY_BATCH_SIZE);
      const results = {
        success: 0,
        failed: 0,
        errors: [] as any[],
      };

      for (const payout of batch) {
        try {
          await this.retryPayout(payout);
          results.success++;
        } catch (error) {
          results.failed++;
          const errorMsg = error instanceof Error ? error.message : String(error);
          results.errors.push({
            payoutReference: payout.payoutReference,
            idempotencyKey: payout.idempotencyKey,
            error: errorMsg,
          });

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
        this.logger.warn('[RETRY_SCHEDULER] Some retries failed', {
          errorCount: results.errors.length,
          errors: results.errors,
        });
      }
    } finally {
      this.isRunning = false;
    }
  }

  /**
   * Retry a single payout
   */
  private async retryPayout(payout: any): Promise<void> {
    // Re-dispatch the payout
    const dispatchResult = await this.settlementService.dispatchB2bPayouts({
      merchantTransactionReference: payout.merchantTransactionReference,
      party: payout.party,
      supplierMerchantId: payout.recipientMerchantId,
      amount: Number(payout.amount),
    });

    if (!dispatchResult.success) {
      // Schedule another retry if gateway rejected
      await this.retryService.scheduleFailedPayoutForRetry(
        payout.idempotencyKey,
        `Gateway response: ${dispatchResult.gatewayResult?.responseDescription || 'Unknown error'}`
      );

      throw new Error(`Payout dispatch failed: ${dispatchResult.gatewayResult?.error || 'Unknown error'}`);
    }

    this.logger.log('[RETRY_SCHEDULER] Successfully retried payout', {
      payoutReference: payout.payoutReference,
      idempotencyKey: payout.idempotencyKey,
      attemptCount: payout.attemptCount,
    });
  }

  /**
   * Get retry scheduler status
   */
  getStatus() {
    return {
      isRunning: this.isRunning,
      isScheduled: !!this.retryJobHandle,
      checkInterval: this.RETRY_CHECK_INTERVAL_MS,
      batchSize: this.RETRY_BATCH_SIZE,
    };
  }

  /**
   * Manually trigger retry processing (for testing or manual intervention)
   */
  async manualRetryRun(): Promise<any> {
    return this.processRetries();
  }
}
