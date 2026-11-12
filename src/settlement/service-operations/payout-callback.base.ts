import { NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { finalizeSettlementPayoutReservationInTransaction } from '../../retailer/services/transfer/helpers/settlement-payout-reservation';
import { SettlementPayoutDispatchBase } from './payout-dispatch.base';

type CallbackOutcome = 'SUCCESSFUL' | 'FAILED' | 'UNKNOWN';

export abstract class SettlementPayoutCallbackBase extends SettlementPayoutDispatchBase {
  async handleB2bPayoutCallback(data: any, callbackIdentifier?: string): Promise<any> {
    const rawResult = data?.Result && typeof data.Result === 'object' ? data.Result : {};
    const payoutReference = String(
      data?.originatorConversationId
        ?? data?.OriginatorConversationID
        ?? rawResult?.OriginatorConversationID
        ?? data?.reference
        ?? '',
    ).trim();
    const resolvedCallbackIdentifier = callbackIdentifier
      ?? data?.callbackIdentifier
      ?? data?.callbackToken
      ?? undefined;
    let payoutAttempt = resolvedCallbackIdentifier
      ? await this.idempotencyService.getPayoutAttemptByCallbackIdentifier?.(resolvedCallbackIdentifier)
      : null;
    if (!payoutAttempt && payoutReference) {
      payoutAttempt = await this.idempotencyService.getPayoutAttemptByReference(payoutReference);
    }
    if (!payoutAttempt) {
      this.logger.warn('[B2B][CALLBACK][UNMATCHED] callback has no matching payout attempt', {
        callbackIdentifier: resolvedCallbackIdentifier ?? null,
        payoutReference: payoutReference || null,
        transactionId: data?.transactionId ?? rawResult?.TransactionID ?? null,
      });
      return {
        success: true,
        accepted: true,
        status: 'UNMATCHED',
        message: 'Callback was acknowledged but no payout attempt matched its callback identifier or originator conversation ID.',
      };
    }

    const resultCode = data?.resultCode ?? data?.ResultCode ?? rawResult?.ResultCode;
    const hasResultCode = resultCode !== undefined && resultCode !== null && String(resultCode).trim() !== '';
    const outcome: CallbackOutcome = !hasResultCode
      ? 'UNKNOWN'
      : Number(resultCode) === 0
        ? 'SUCCESSFUL'
        : 'FAILED';
    const settlementId = payoutAttempt.settlementId;
    const committed = await this.prisma.$transaction(async (tx) => {
      const currentAttempt = await tx.b2BPayoutAttempt.findUnique({ where: { id: payoutAttempt.id } });
      if (!currentAttempt) throw new NotFoundException(`Payout attempt ${payoutAttempt.id} was not found`);
      const currentStatus = String(currentAttempt.status).toUpperCase();
      const terminal = ['SUCCESSFUL', 'COMPLETED', 'FAILED'].includes(currentStatus);
      if (terminal || (currentStatus === 'UNKNOWN' && outcome === 'UNKNOWN')) {
        return { duplicate: true, status: currentStatus, settlementStatus: undefined };
      }

      const callbackPayload = data as Prisma.InputJsonValue;
      const updatedAttempt = await tx.b2BPayoutAttempt.updateMany({
        where: { id: currentAttempt.id, status: currentAttempt.status },
        data: {
          status: outcome,
          callbackReceived: true,
          callbackReceivedAt: new Date(),
          metadata: {
            ...(currentAttempt.metadata && typeof currentAttempt.metadata === 'object'
              ? currentAttempt.metadata as Record<string, any>
              : {}),
            lastPayoutCallback: callbackPayload,
          } as Prisma.InputJsonValue,
        },
      });
      if (updatedAttempt.count !== 1) {
        return { duplicate: true, status: currentStatus, settlementStatus: undefined };
      }

      const attempts = await tx.b2BPayoutAttempt.findMany({
        where: { settlementId },
        select: { status: true },
      });
      const settlement = await tx.settlement.findUnique({ where: { id: settlementId } });
      if (!settlement) throw new NotFoundException(`Settlement ${settlementId} was not found`);
      const existingMetadata = settlement.metadata && typeof settlement.metadata === 'object'
        ? settlement.metadata as Record<string, any>
        : {};
      const allocationPlan = existingMetadata.allocationPlan && typeof existingMetadata.allocationPlan === 'object'
        ? existingMetadata.allocationPlan as Record<string, any>
        : null;
      const expectedCount = Number(
        existingMetadata.splitRecords?.at?.(-1)?.expectedPayoutCount
          ?? allocationPlan?.payoutInstructions?.length
          ?? allocationPlan?.allocations?.filter?.((allocation: any) => (
            allocation.destination === 'B2B payout' && Number(allocation.amount) > 0
          )).length
          ?? 0,
      );
      const hasUnknown = attempts.some((attempt: { status: string }) => attempt.status === 'UNKNOWN');
      const hasPending = attempts.some((attempt: { status: string }) => (
        ['PENDING', 'SUBMITTED', 'RETRYING'].includes(attempt.status)
      ));
      const allExpectedAttemptsPresent = expectedCount <= 0 || attempts.length >= expectedCount;
      const allTerminal = allExpectedAttemptsPresent && !hasUnknown && !hasPending;

      if (allTerminal) {
        await finalizeSettlementPayoutReservationInTransaction(tx, settlementId);
      }
      const latestSettlement = await tx.settlement.findUnique({ where: { id: settlementId } });
      const latestMetadata = latestSettlement?.metadata && typeof latestSettlement.metadata === 'object'
        ? latestSettlement.metadata as Record<string, any>
        : existingMetadata;
      const payoutCallbacks = Array.isArray(latestMetadata.payoutCallbacks)
        ? latestMetadata.payoutCallbacks
        : [];
      const payoutCallback = {
        payoutReference: currentAttempt.payoutReference,
        originatorConversationId: payoutReference || null,
        transactionId: data?.transactionId ?? rawResult?.TransactionID ?? null,
        party: currentAttempt.party,
        recipientMerchantId: currentAttempt.recipientMerchantId,
        amount: Number(currentAttempt.amount),
        resultCode: hasResultCode ? Number(resultCode) : null,
        resultDescription: data?.resultDescription ?? data?.ResultDesc ?? rawResult?.ResultDesc ?? null,
        status: outcome,
        callbackIdentifier: resolvedCallbackIdentifier ?? currentAttempt.callbackIdentifier ?? null,
        processedAt: new Date().toISOString(),
      };
      const latestAllocationPlan = latestMetadata.allocationPlan && typeof latestMetadata.allocationPlan === 'object'
        ? latestMetadata.allocationPlan as Record<string, any>
        : null;
      const allocations = Array.isArray(latestAllocationPlan?.allocations)
        ? latestAllocationPlan.allocations.map((allocation: any) => (
          allocation.payoutReference === currentAttempt.payoutReference
            || (
              allocation.party === currentAttempt.party
              && (
                currentAttempt.party !== 'SUPPLIER'
                || allocation.supplierMerchantId === currentAttempt.recipientMerchantId
              )
            )
            ? {
              ...allocation,
              status: outcome,
              payoutReference: currentAttempt.payoutReference,
              paidAt: outcome === 'SUCCESSFUL' ? new Date().toISOString() : allocation.paidAt,
            }
            : allocation
        ))
        : undefined;
      const settlementStatus = hasUnknown
        ? 'AWAITING_RECONCILIATION'
        : hasPending || !allExpectedAttemptsPresent
          ? 'PROCESSING'
          : attempts.every((attempt: { status: string }) => ['SUCCESSFUL', 'COMPLETED'].includes(attempt.status))
            ? 'COMPLETED'
            : 'PROCESSING_FAILED';
      await tx.settlement.update({
        where: { id: settlementId },
        data: {
          status: settlementStatus,
          ...(settlementStatus === 'COMPLETED' ? { completedAt: new Date() } : {}),
          ...(settlementStatus === 'PROCESSING_FAILED' ? { failedAt: new Date() } : {}),
          metadata: {
            ...latestMetadata,
            payoutCallbacks: [...payoutCallbacks, payoutCallback],
            lastPayoutCallback: payoutCallback,
            ...(latestAllocationPlan && allocations
              ? { allocationPlan: { ...latestAllocationPlan, allocations } }
              : {}),
          } as Prisma.InputJsonValue,
        },
      });
      return { duplicate: false, status: outcome, settlementStatus, payoutCallback };
    });

    if (committed.duplicate) {
      return {
        success: true,
        status: payoutAttempt.status,
        duplicate: true,
        settlementId,
        payoutReference: payoutAttempt.payoutReference,
      };
    }
    if (committed.settlementStatus === 'AWAITING_RECONCILIATION') {
      await this.repository.notifyWebhookEvent?.(settlementId, 'payment.settlement.reconciliation_required', {
        payout_reference: payoutAttempt.payoutReference,
        payout_status: outcome,
        reason: 'Payout callback did not contain a final M-Pesa ResultCode',
      });
    } else if (committed.settlementStatus === 'PROCESSING_FAILED') {
      await this.repository.notifyWebhookEvent?.(settlementId, 'payment.settlement.partially_failed', {
        party: payoutAttempt.party,
        payout_status: outcome,
        failure_reason: data?.resultDescription ?? data?.ResultDesc ?? rawResult?.ResultDesc ?? null,
        payout_reference: payoutAttempt.payoutReference,
      });
    } else if (committed.settlementStatus === 'COMPLETED') {
      await this.repository.notifyWebhookEvent?.(settlementId, 'payment.settlement.completed');
    } else {
      await this.repository.notifyWebhookEvent?.(settlementId, 'payment.settlement.progress', {
        payout_reference: payoutAttempt.payoutReference,
        payout_status: outcome,
      });
    }
    return {
      success: true,
      status: outcome,
      settlementStatus: committed.settlementStatus,
      settlementId,
      payoutCallback: committed.payoutCallback,
    };
  }
}
