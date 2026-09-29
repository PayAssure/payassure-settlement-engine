import { RetryContextBase } from './retry-context.base';
import type { RetryPolicy, RetrySchedule } from './types';

export abstract class RetryPolicyBase extends RetryContextBase {
  calculateNextRetryDelay(attemptCount: number, policy?: Partial<RetryPolicy>): RetrySchedule {
    const policyConfig = { ...this.defaultRetryPolicy, ...policy };
    if (attemptCount > policyConfig.maxRetries) {
      throw new Error(`Max retries exceeded. Attempt ${attemptCount} exceeds max of ${policyConfig.maxRetries}`);
    }
    const exponentialDelay = policyConfig.initialDelayMs * Math.pow(policyConfig.backoffMultiplier, attemptCount - 1);
    const delayMs = Math.min(exponentialDelay, policyConfig.maxDelayMs);
    const jitter = delayMs * 0.1 * (Math.random() - 0.5);
    const finalDelayMs = Math.max(policyConfig.initialDelayMs, delayMs + jitter);
    return {
      attempt: attemptCount + 1,
      delayMs: Math.round(finalDelayMs),
      nextRetryAt: new Date(Date.now() + finalDelayMs),
    };
  }

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
}
