import { RetryPolicyBase } from './policy.base';
import type { RetryPolicy, RetrySchedule } from './types';

export abstract class RetrySchedulingBase extends RetryPolicyBase {
  async scheduleFailedPayoutForRetry(idempotencyKey: string, failureReason?: string, customPolicy?: Partial<RetryPolicy>): Promise<RetrySchedule | null> {
    const attempt = await this.idempotencyService.getPayoutAttempt(idempotencyKey);
    if (!attempt) throw new Error(`Payout attempt not found: ${idempotencyKey}`);
    const policy = await this.getRetryPolicy();
    const mergedPolicy = { ...policy, ...customPolicy };
    if (attempt.attemptCount >= mergedPolicy.maxRetries) {
      this.logger.warn('[RETRY] Max retries exceeded, marking as failed', {
        idempotencyKey,
        attemptCount: attempt.attemptCount,
        maxRetries: mergedPolicy.maxRetries,
      });
      await this.prisma.b2BPayoutAttempt.update({
        where: { id: attempt.id },
        data: { status: 'FAILED', failureReason: failureReason || 'Max retries exceeded' },
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
}
