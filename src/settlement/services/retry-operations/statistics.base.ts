import { RetryBatchProcessingBase } from './batch-processing.base';

export abstract class RetryStatisticsBase extends RetryBatchProcessingBase {
  async getRetryStatistics(settlementId: string): Promise<any> {
    const payouts = await this.idempotencyService.getSettlementPayouts(settlementId);
    return {
      totalPayouts: payouts.length,
      completed: payouts.filter((p) => p.status === 'COMPLETED').length,
      submitted: payouts.filter((p) => p.status === 'SUBMITTED').length,
      pending: payouts.filter((p) => p.status === 'PENDING').length,
      retrying: payouts.filter((p) => p.status === 'RETRYING').length,
      failed: payouts.filter((p) => p.status === 'FAILED').length,
      totalAttempts: payouts.reduce((sum, p) => sum + p.attemptCount, 0),
      averageAttempts: payouts.length > 0 ? payouts.reduce((sum, p) => sum + p.attemptCount, 0) / payouts.length : 0,
    };
  }

  async cancelPayoutRetries(settlementId: string): Promise<number> {
    const result = await this.prisma.b2BPayoutAttempt.updateMany({
      where: { settlementId, status: { in: ['RETRYING', 'PENDING'] } },
      data: { status: 'FAILED', failureReason: 'Settlement cancelled' },
    });
    this.logger.log('[RETRY] Cancelled payouts for settlement', { settlementId, cancelledCount: result.count });
    return result.count;
  }
}
