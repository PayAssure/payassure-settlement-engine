import { NotFoundException } from '@nestjs/common';
import { SettlementPayoutDispatchBase } from './payout-dispatch.base';

export abstract class SettlementPayoutCallbackBase extends SettlementPayoutDispatchBase {
  async handleB2bPayoutCallback(data: any, callbackIdentifier?: string): Promise<any> {
    const payoutAttempt = data.reference && typeof this.idempotencyService.getPayoutAttemptByReference === 'function'
      ? await this.idempotencyService.getPayoutAttemptByReference(String(data.reference))
      : null;
    let settlement = null;
    if (callbackIdentifier) {
      settlement = await this.repository.findSettlementByPayoutCallbackIdentifier(callbackIdentifier);
    }
    if (!settlement) {
      const fallbackReferences = [
        data?.callbackIdentifier,
        data?.callbackToken,
        data?.merchantTransactionReference,
        data?.metadata?.merchantTransactionReference,
        data?.providerReference,
        data?.transactionId,
      ].filter(Boolean);
      for (const ref of fallbackReferences) {
        settlement = await this.repository.findSettlementByReference(ref);
        if (settlement) break;
      }
    }
    if (!settlement && payoutAttempt?.settlementId) {
      settlement = await this.repository.findSettlementById(payoutAttempt.settlementId);
    }
    if (!settlement && !payoutAttempt) {
      this.logger.warn('[B2B][CALLBACK][UNMATCHED] callback acknowledged without settlement or payout attempt', {
        callbackIdentifier: callbackIdentifier ?? null,
        merchantTransactionReference: data?.merchantTransactionReference ?? null,
        reference: data?.reference ?? null,
        transactionId: data?.transactionId ?? null,
        status: data?.status ?? null,
        callback: data,
      });
      return {
        success: true,
        accepted: true,
        status: 'UNMATCHED',
        message: 'M-Pesa callback was received and logged, but no settlement payout was found.',
        callback: data,
      };
    }
    if (!settlement) {
      this.logger.error('[B2B][CALLBACK][LOOKUP] settlement not found', {
        callbackIdentifier,
        merchantTransactionReference: data?.merchantTransactionReference ?? null,
        reference: data?.reference ?? null,
        transactionId: data?.transactionId ?? null,
      });
      throw new NotFoundException({ statusCode: 404, message: 'Settlement not found for the provided B2B callback reference', error: 'SETTLEMENT_NOT_FOUND' });
    }
    const party = (String(data.party || payoutAttempt?.party || 'SUPPLIER').toUpperCase() as 'SUPPLIER' | 'RETAILER');
    const payoutStatus = String(data.status || 'FAILED').toUpperCase();
    const isSuccess = payoutStatus === 'SUCCESS' || payoutStatus === 'PAID';
    const status = isSuccess ? 'PAID' : 'FAILED';
    if (payoutAttempt?.idempotencyKey) {
      try {
        await this.idempotencyService.markCallbackReceived(payoutAttempt.idempotencyKey, data);
        this.logger.log('[B2B][CALLBACK] Marked payout attempt callback as received', {
          payoutReference: data.reference,
          payoutStatus: status,
        });
      } catch (error) {
        this.logger.warn('[B2B][CALLBACK] Failed to update payout attempt callback tracking', {
          payoutReference: data.reference,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    } else if (data.callbackIdentifier || data.callbackToken) {
      const callbackRef = data.callbackIdentifier ?? data.callbackToken;
      try {
        await this.idempotencyService.markCallbackReceived(callbackRef, data);
        this.logger.log('[B2B][CALLBACK] Marked callback as received in idempotency tracking', {
          callbackIdentifier: callbackRef,
          payoutStatus: status,
        });
      } catch (error) {
        this.logger.warn('[B2B][CALLBACK] Failed to update idempotency tracking', {
          callbackIdentifier: callbackRef,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
    const existingMetadata = (settlement.metadata && typeof settlement.metadata === 'object') ? settlement.metadata as Record<string, any> : {};
    const currentAllocation = Array.isArray(existingMetadata.allocationPlan?.allocations)
      ? existingMetadata.allocationPlan.allocations.map((allocation: any) => {
          if (allocation.party === party) {
            return {
              ...allocation,
              status,
              paidAt: new Date().toISOString(),
              payoutReference: data.reference,
              payoutStatus: status,
            };
          }
          return allocation;
        })
      : [];
    const payoutCallback = {
      transactionId: data.transactionId,
      reference: data.reference,
      merchantTransactionReference: data.merchantTransactionReference,
      settlementReference: settlement.reference,
      party,
      supplierMerchantId: this.resolveSupplierMerchantId(settlement, data.supplierMerchantId) ?? null,
      status,
      providerReference: data.providerReference ?? null,
      amount: data.amount ?? null,
      metadata: data.metadata ?? {},
      processedAt: new Date().toISOString(),
    };
    const payoutCallbacks = Array.isArray(existingMetadata.payoutCallbacks) ? existingMetadata.payoutCallbacks : [];
    const updatedMetadata = {
      ...existingMetadata,
      payoutCallbacks: [...payoutCallbacks, payoutCallback],
      allocationPlan: existingMetadata.allocationPlan
        ? { ...existingMetadata.allocationPlan, allocations: currentAllocation }
        : existingMetadata.allocationPlan,
      lastPayoutCallback: payoutCallback,
    };
    const nextStatus = isSuccess ? 'PROCESSING' : 'FAILED';
    await this.repository.updateSettlementStatus(settlement.id, nextStatus, { metadata: updatedMetadata });
    if (isSuccess && existingMetadata.escrowFunding?.payoutSource === 'CENTRAL_ACCOUNT') {
      await this.finalizeDirectCashLedger(settlement.id);
    }
    if (!isSuccess) {
      await this.repository.notifyWebhookEvent?.(settlement.id, 'payment.settlement.partially_failed', {
        party,
        payout_status: status,
        failure_reason: data.resultDescription ?? data.failureReason ?? null,
        payout_reference: data.reference ?? null,
      });
    }
    return { success: true, status: nextStatus, settlementId: settlement.id, payoutCallback };
  }

  private async finalizeDirectCashLedger(settlementId: string): Promise<void> {
    const currentSettlement = await this.prisma.settlement.findUnique({
      where: { id: settlementId },
      select: { metadata: true },
    });
    const metadata = currentSettlement?.metadata && typeof currentSettlement.metadata === 'object'
      ? currentSettlement.metadata as Record<string, any>
      : {};
    const escrowFunding = metadata.escrowFunding && typeof metadata.escrowFunding === 'object'
      ? metadata.escrowFunding as Record<string, any>
      : {};
    if (escrowFunding.payoutSource !== 'CENTRAL_ACCOUNT') return;

    const splitRecords = Array.isArray(metadata.splitRecords) ? metadata.splitRecords : [];
    const expectedPayoutCount = Number(splitRecords.at(-1)?.expectedPayoutCount ?? 0);
    if (expectedPayoutCount <= 0) return;

    const transfer = escrowFunding.transferId
      ? await this.prisma.retailerEscrowTransfer.findUnique({ where: { id: escrowFunding.transferId } })
      : await this.prisma.retailerEscrowTransfer.findUnique({ where: { settlementId } });
    if (!transfer || transfer.status !== 'BALANCE_VERIFIED') return;

    const attempts = await this.prisma.b2BPayoutAttempt.findMany({
      where: { settlementId },
      select: { status: true },
    });
    if (attempts.length < expectedPayoutCount || attempts.some((attempt: { status: string }) => attempt.status !== 'COMPLETED')) return;

    await this.prisma.retailerEscrowTransfer.updateMany({
      where: { id: transfer.id, status: 'BALANCE_VERIFIED' },
      data: {
        status: 'SUCCEEDED',
        transferCallback: {
          source: 'CENTRAL_ACCOUNT_PAYOUT_CALLBACKS',
          expectedPayoutCount,
          confirmedPayoutCount: attempts.length,
          confirmedAt: new Date().toISOString(),
        },
      },
    });
  }
}
