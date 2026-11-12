import { BadRequestException, Logger } from '@nestjs/common';
import { Prisma, PrismaClient } from '@prisma/client';
import { prisma } from '../../../../common/database/prisma';
import { updateEscrowSettlementMetadata } from '../../retailer-escrow-transfer.helpers';

const logger = new Logger('SettlementPayoutReservation');

export async function finalizeSettlementPayoutReservation(
  settlementId: string,
  client: PrismaClient = prisma,
): Promise<{
  finalized: boolean;
  status?: string;
  settlementStatus?: string;
  debitedAmount?: number;
}> {
  return client.$transaction((tx) => finalizeSettlementPayoutReservationInTransaction(tx, settlementId));
}

export async function finalizeSettlementPayoutReservationInTransaction(
  tx: Prisma.TransactionClient,
  settlementId: string,
): Promise<{
  finalized: boolean;
  status?: string;
  settlementStatus?: string;
  debitedAmount?: number;
}> {
  const settlement = await tx.settlement.findUnique({ where: { id: settlementId } });
  if (!settlement) return { finalized: false };
  const metadata = settlement.metadata && typeof settlement.metadata === 'object'
    ? settlement.metadata as Record<string, any>
    : {};
  const escrowFunding = metadata.escrowFunding && typeof metadata.escrowFunding === 'object'
    ? metadata.escrowFunding as Record<string, any>
    : {};
  if (escrowFunding.payoutSource !== 'CENTRAL_ACCOUNT') return { finalized: false };

  const splitRecords = Array.isArray(metadata.splitRecords) ? metadata.splitRecords : [];
  const allocationPlan = metadata.allocationPlan && typeof metadata.allocationPlan === 'object'
    ? metadata.allocationPlan as Record<string, any>
    : {};
  const allocationCount = Array.isArray(allocationPlan.payoutInstructions)
    ? allocationPlan.payoutInstructions.filter((instruction: any) => Number(instruction.amount) > 0).length
    : Array.isArray(allocationPlan.allocations)
      ? allocationPlan.allocations.filter((allocation: any) => (
        allocation.destination === 'B2B payout' && Number(allocation.amount) > 0
      )).length
      : 0;
  const expectedPayoutCount = Number(splitRecords.at(-1)?.expectedPayoutCount ?? allocationCount);
  if (!Number.isInteger(expectedPayoutCount) || expectedPayoutCount <= 0) return { finalized: false };

  const transfer = escrowFunding.transferId
    ? await tx.retailerEscrowTransfer.findUnique({ where: { id: escrowFunding.transferId } })
    : await tx.retailerEscrowTransfer.findUnique({ where: { settlementId } });
  if (!transfer || transfer.status !== 'BALANCE_VERIFIED') return { finalized: false };

  const attempts = await tx.b2BPayoutAttempt.findMany({
    where: { settlementId },
    select: { status: true, metadata: true },
  });
  if (attempts.length < expectedPayoutCount) return { finalized: false };
  if (attempts.some((attempt: { status: string }) => ['PENDING', 'SUBMITTED', 'RETRYING', 'UNKNOWN'].includes(attempt.status))) {
    return { finalized: false };
  }

  const successfulAttempts = attempts.filter((attempt: { status: string }) => (
    attempt.status === 'SUCCESSFUL' || attempt.status === 'COMPLETED'
  ));
  const hasExplicitFunding = successfulAttempts.some((attempt: any) => (
    attempt.metadata
    && typeof attempt.metadata === 'object'
    && Object.prototype.hasOwnProperty.call(attempt.metadata, 'escrowFundedAmount')
  ));
  const requestedDebit = hasExplicitFunding
    ? successfulAttempts.reduce((sum: number, attempt: any) => (
      sum + Math.max(0, Number(attempt.metadata?.escrowFundedAmount ?? 0))
    ), 0)
    : successfulAttempts.length === attempts.length
      ? Number(transfer.amount)
      : 0;
  const reservedAmount = Number(transfer.amount);
  if (!Number.isFinite(requestedDebit) || requestedDebit > reservedAmount) {
    throw new BadRequestException(
      `Confirmed payout debit ${requestedDebit} exceeds reserved escrow amount ${reservedAmount} for settlement ${settlementId}`,
    );
  }
  const debitedAmount = new Prisma.Decimal(requestedDebit);
  const hasFailedPayout = attempts.some((attempt: { status: string }) => attempt.status === 'FAILED');
  const transferStatus = requestedDebit > 0
    ? 'SUCCEEDED'
    : hasFailedPayout
      ? 'FAILED'
      : 'RELEASED';
  const updated = await tx.retailerEscrowTransfer.updateMany({
    where: { id: transfer.id, status: 'BALANCE_VERIFIED' },
    data: {
      status: transferStatus,
      debitedAmount,
      ...(hasFailedPayout ? { failureReason: 'One or more payout callbacks reported failure' } : {}),
      transferCallback: {
        source: 'CENTRAL_ACCOUNT_PAYOUT_CALLBACKS',
        expectedPayoutCount,
        confirmedPayoutCount: attempts.length,
        successfulPayoutCount: successfulAttempts.length,
        reservedAmount,
        debitedAmount: requestedDebit,
        finalizedAt: new Date().toISOString(),
      },
    },
  });
  if (updated.count !== 1) return { finalized: false };

  await updateEscrowSettlementMetadata(settlementId, {
    escrowStatus: transferStatus,
    reservedAmount,
    debitedAmount: requestedDebit,
    payoutReservationFinalizedAt: new Date().toISOString(),
  }, tx, successfulAttempts.length === attempts.length ? 'COMPLETED' : 'PROCESSING_FAILED');

  logger.log('[ESCROW_TRANSFER][PAYOUT_RESERVATION][FINALIZED]', {
    settlementId,
    transferId: transfer.id,
    status: transferStatus,
    reservedAmount,
    debitedAmount: requestedDebit,
  });
  return {
    finalized: true,
    status: transferStatus,
    settlementStatus: successfulAttempts.length === attempts.length ? 'COMPLETED' : 'PROCESSING_FAILED',
    debitedAmount: requestedDebit,
  };
}
