import { RetrySchedulingBase } from './scheduling.base';

export abstract class RetryBatchProcessingBase extends RetrySchedulingBase {
  async getPayoutsDueForRetry(): Promise<any[]> {
    const pendingRetries = await this.idempotencyService.getPendingRetries();
    return pendingRetries.filter((payout) => ['FAILED', 'RETRYING'].includes(payout.status));
  }

  async processPendingRetries(batchSize: number = 10): Promise<any[]> {
    const payoutsDueForRetry = await this.getPayoutsDueForRetry();
    const batch = payoutsDueForRetry.slice(0, batchSize);
    const results = [];
    for (const payout of batch) {
      try {
        await this.prisma.b2BPayoutAttempt.update({
          where: { id: payout.id },
          data: { status: 'RETRYING', lastAttemptAt: new Date() },
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
}
