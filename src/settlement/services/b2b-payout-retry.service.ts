import { Injectable, Logger } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { B2BPayoutIdempotencyService } from './b2b-payout-idempotency.service';

export interface RetryPolicy {
  maxRetries: number;
  initialDelayMs: number;
  maxDelayMs: number;
  backoffMultiplier: number;
}

export interface RetrySchedule {
  attempt: number;
  delayMs: number;
  nextRetryAt: Date;
}

/**
 * B2BPayoutRetryService handles retry logic for failed payouts with configurable time intervals
 * Supports exponential backoff or fixed delay strategies
 */
@Injectable()
export class B2BPayoutRetryService {
  private prisma: PrismaClient;
  private readonly logger = new Logger(B2BPayoutRetryService.name);

  // Default retry policy: 5 max retries, starting at 1 minute, max 1 hour, exponential backoff
  private readonly defaultRetryPolicy: RetryPolicy = {
    maxRetries: 5,
    initialDelayMs: 60000,      // 1 minute
    maxDelayMs: 3600000,        // 1 hour
    backoffMultiplier: 2.0,     // Double the delay each retry
  };

  constructor(private idempotencyService: B2BPayoutIdempotencyService) {
    this.prisma = new PrismaClient();
  }

  /**
   * Calculate the delay for the next retry using exponential backoff
   * Formula: min(initialDelay * (backoffMultiplier ^ (attemptNumber - 1)), maxDelay)
   */
  calculateNextRetryDelay(attemptCount: number, policy?: Partial<RetryPolicy>): RetrySchedule {
    const policyConfig = { ...this.defaultRetryPolicy, ...policy };

    if (attemptCount > policyConfig.maxRetries) {
      throw new Error(`Max retries exceeded. Attempt ${attemptCount} exceeds max of ${policyConfig.maxRetries}`);
    }

    // Calculate delay with exponential backoff
    const exponentialDelay = policyConfig.initialDelayMs * Math.pow(policyConfig.backoffMultiplier, attemptCount - 1);
    const delayMs = Math.min(exponentialDelay, policyConfig.maxDelayMs);

    // Add jitter to prevent thundering herd (random ±10%)
    const jitter = delayMs * 0.1 * (Math.random() - 0.5);
    const finalDelayMs = Math.max(policyConfig.initialDelayMs, delayMs + jitter);

    const nextRetryAt = new Date(Date.now() + finalDelayMs);

    return {
      attempt: attemptCount + 1,
      delayMs: Math.round(finalDelayMs),
      nextRetryAt,
    };
  }

  /**
   * Get retry policy from database or use default
   */
  async getRetryPolicy(): Promise<RetryPolicy> {
    try {
      const policy = await this.prisma.b2BPayoutRetryPolicy.findFirst();
      if (policy) {
        return {
          maxRetries: policy.maxRetries,
          initialDelayMs: policy.initialDelayMs,
          maxDelayMs: policy.maxDelayMs,
          backoffMultiplier: policy.backoffMultiplier,
        };
      }
    } catch (error) {
      this.logger.warn('Failed to fetch retry policy from database, using defaults', {
        error: error instanceof Error ? error.message : String(error),
      });
    }

    return this.defaultRetryPolicy;
  }

  /**
   * Schedule a failed payout for retry
   */
  async scheduleFailedPayoutForRetry(
    idempotencyKey: string,
    failureReason?: string,
    customPolicy?: Partial<RetryPolicy>
  ): Promise<RetrySchedule | null> {
    const attempt = await this.idempotencyService.getPayoutAttempt(idempotencyKey);
    if (!attempt) {
      throw new Error(`Payout attempt not found: ${idempotencyKey}`);
    }

    const policy = await this.getRetryPolicy();
    const mergedPolicy = { ...policy, ...customPolicy };

    // Check if max retries exceeded
    if (attempt.attemptCount >= mergedPolicy.maxRetries) {
      this.logger.warn('[RETRY] Max retries exceeded, marking as failed', {
        idempotencyKey,
        attemptCount: attempt.attemptCount,
        maxRetries: mergedPolicy.maxRetries,
      });

      // Mark as permanently failed
      await this.prisma.b2BPayoutAttempt.update({
        where: { id: attempt.id },
        data: {
          status: 'FAILED',
          failureReason: failureReason || 'Max retries exceeded',
        },
      });

      return null;
    }

    const schedule = this.calculateNextRetryDelay(attempt.attemptCount, mergedPolicy);

    await this.idempotencyService.scheduleRetry(idempotencyKey, schedule.delayMs, failureReason);

    this.logger.log('[RETRY] Payout scheduled for retry', {
      idempotencyKey,
      attemptCount: schedule.attempt,
      delayMs: schedule.delayMs,
      nextRetryAt: schedule.nextRetryAt,
      failureReason,
    });

    return schedule;
  }

  /**
   * Get all payouts due for retry
   */
  async getPayoutsDueForRetry(): Promise<any[]> {
    const pendingRetries = await this.idempotencyService.getPendingRetries();

    return pendingRetries.filter((payout) => {
      // Only retry if status is FAILED or RETRYING
      return ['FAILED', 'RETRYING'].includes(payout.status);
    });
  }

  /**
   * Process retries in batch
   */
  async processPendingRetries(batchSize: number = 10): Promise<any[]> {
    const payoutsDueForRetry = await this.getPayoutsDueForRetry();
    const batch = payoutsDueForRetry.slice(0, batchSize);

    const results = [];

    for (const payout of batch) {
      try {
        // Mark as retrying (status will be updated when next dispatch attempt is made)
        await this.prisma.b2BPayoutAttempt.update({
          where: { id: payout.id },
          data: {
            status: 'RETRYING',
            lastAttemptAt: new Date(),
          },
        });

        results.push({
          idempotencyKey: payout.idempotencyKey,
          payoutReference: payout.payoutReference,
          status: 'READY_FOR_RETRY',
          attemptCount: payout.attemptCount,
          nextRetryAt: payout.nextRetryAt,
        });
      } catch (error) {
        this.logger.error('[RETRY] Failed to process retry', {
          idempotencyKey: payout.idempotencyKey,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    return results;
  }

  /**
   * Get retry statistics for a settlement
   */
  async getRetryStatistics(settlementId: string): Promise<any> {
    const payouts = await this.idempotencyService.getSettlementPayouts(settlementId);

    const stats = {
      totalPayouts: payouts.length,
      completed: payouts.filter((p) => p.status === 'COMPLETED').length,
      submitted: payouts.filter((p) => p.status === 'SUBMITTED').length,
      pending: payouts.filter((p) => p.status === 'PENDING').length,
      retrying: payouts.filter((p) => p.status === 'RETRYING').length,
      failed: payouts.filter((p) => p.status === 'FAILED').length,
      totalAttempts: payouts.reduce((sum, p) => sum + p.attemptCount, 0),
      averageAttempts: payouts.length > 0 ? payouts.reduce((sum, p) => sum + p.attemptCount, 0) / payouts.length : 0,
    };

    return stats;
  }

  /**
   * Cancel retries for a settlement (e.g., if settlement is cancelled)
   */
  async cancelPayoutRetries(settlementId: string): Promise<number> {
    const result = await this.prisma.b2BPayoutAttempt.updateMany({
      where: {
        settlementId,
        status: { in: ['RETRYING', 'PENDING'] },
      },
      data: {
        status: 'FAILED',
        failureReason: 'Settlement cancelled',
      },
    });

    this.logger.log('[RETRY] Cancelled payouts for settlement', {
      settlementId,
      cancelledCount: result.count,
    });

    return result.count;
  }

  async onModuleDestroy() {
    await this.prisma.$disconnect();
  }
}
