import { NotFoundException } from '@nestjs/common';
import { SettlementHistoryAndReconciliationBase } from './history-and-reconciliation.base';

export abstract class SettlementRetryManagementBase extends SettlementHistoryAndReconciliationBase {
  async getPayoutRetryStatistics(settlementId: string): Promise<any> {
    return this.retryService.getRetryStatistics(settlementId);
  }

  async getPendingPayoutRetries(): Promise<any[]> {
    return this.retryService.getPayoutsDueForRetry();
  }

  async manualRetryPayouts(settlementId: string): Promise<any> {
    const settlement = await this.repository.findSettlementById(settlementId);
    if (!settlement) {
      throw new NotFoundException({ statusCode: 404, message: 'Settlement not found', error: 'SETTLEMENT_NOT_FOUND' });
    }
    const payouts = await this.idempotencyService.getSettlementPayouts(settlementId);
    const failedPayouts = payouts.filter((p) => ['FAILED', 'RETRYING'].includes(p.status));
    if (failedPayouts.length === 0) return { success: true, message: 'No failed payouts to retry', count: 0 };
    const results = [];
    for (const payout of failedPayouts) {
      try {
        const dispatchResult = await this.dispatchB2bPayouts({
          merchantTransactionReference: payout.merchantTransactionReference,
          party: payout.party,
          supplierMerchantId: payout.recipientMerchantId,
          amount: Number(payout.amount),
        });
        results.push({ payoutReference: payout.payoutReference, status: dispatchResult.status, success: dispatchResult.success });
      } catch (error) {
        results.push({ payoutReference: payout.payoutReference, status: 'FAILED', error: error instanceof Error ? error.message : String(error) });
      }
    }
    return {
      success: true,
      message: `Manually retried ${failedPayouts.length} failed payouts`,
      count: failedPayouts.length,
      results,
    };
  }
}
