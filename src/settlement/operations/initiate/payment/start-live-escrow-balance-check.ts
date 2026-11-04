import { SettlementStatus } from '@prisma/client';
import { retailerEscrowTransferService } from '../../../../retailer';
import { buildSettlementResult } from '../helpers/build-settlement-result';
import type { SettlementInitiationContext } from '../context';

export async function startLiveEscrowBalanceCheck(
  context: SettlementInitiationContext,
  amounts: { cashAmount: number; hasLiveEscrowFloat: boolean },
) {
  const { data, repository, logger, primarySettlement, retailerMerchantId } = context;
  const { cashAmount, hasLiveEscrowFloat } = amounts;

  if (!hasLiveEscrowFloat) {
    const reason = `Retailer escrow daily float is not configured for ${retailerMerchantId}; CASH settlement was blocked.`;
    logger.warn('[CASH_FLOW][ESCROW_CONFIG_MISSING]', {
      settlementId: primarySettlement.id,
      retailerMerchantId,
      cashAmount,
      provider: 'MPESA_RETAILER_ESCROW',
    });
    await repository.updateSettlementStatus(primarySettlement.id, SettlementStatus.FAILED, {
      metadata: {
        ...(data.metadata ?? {}),
        escrowFunding: { status: 'BLOCKED', reason, retailerMerchantId },
      },
      failedAt: new Date(),
    });
    return {
      success: false,
      settlement: buildSettlementResult(context, { status: SettlementStatus.FAILED, estimatedProcessingTime: 'N/A' }),
      message: reason,
    };
  }

  const initialMetadata = {
    ...(data.metadata ?? {}),
    fundingPlan: {
      cashAmount,
      mpesaAmount: 0,
      mpesaStatus: 'NOT_REQUIRED',
    },
    escrowFunding: {
      provider: 'MPESA_ESCROW',
      status: 'LEDGER_CHECK_PENDING',
      retailerMerchantId,
      cashAmount,
      mpesaAmount: 0,
    },
  };
  await repository.updateSettlementStatus(primarySettlement.id, SettlementStatus.PENDING_PROCESSING, {
    metadata: initialMetadata,
  });

  try {
    logger.log('[CASH_FLOW][ESCROW_BALANCE_CHECK][START]', {
      settlementId: primarySettlement.id,
      retailerMerchantId,
      cashAmount,
      provider: 'MPESA_RETAILER_ESCROW',
    });
    const balanceCheck = await retailerEscrowTransferService.startForSettlement({
      settlementId: primarySettlement.id,
      merchantTransactionReference: data.merchantTransactionReference,
      retailerMerchantId,
      cashAmount,
      mpesaAmount: 0,
    });
    logger.log('[CASH_FLOW][ESCROW_BALANCE_CHECK][VERIFIED]', {
      settlementId: primarySettlement.id,
      transferId: balanceCheck.transferId,
      retailerMerchantId,
      status: balanceCheck.status,
      provider: 'MPESA_RETAILER_ESCROW',
    });
    return {
      success: true,
      cashAllocationReady: true,
      settlement: buildSettlementResult(context, {
        status: SettlementStatus.PENDING_PROCESSING,
        estimatedProcessingTime: 'Awaiting payout callbacks',
      }),
      message: 'Retailer escrow ledger balance verified. Settlement payouts are being dispatched directly from the centralized account.',
      escrowFunding: initialMetadata.escrowFunding,
      balanceCheck,
    };
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    logger.error('[CASH_FLOW][ESCROW_BALANCE_CHECK][FAILED]', {
      settlementId: primarySettlement.id,
      retailerMerchantId,
      cashAmount,
      provider: 'MPESA_RETAILER_ESCROW',
      error: reason,
    });
    await repository.updateSettlementStatus(primarySettlement.id, SettlementStatus.FAILED, {
      metadata: {
        ...initialMetadata,
        escrowFunding: { ...initialMetadata.escrowFunding, status: 'FAILED', reason },
      },
      failedAt: new Date(),
    });
    return {
      success: false,
      settlement: buildSettlementResult(context, { status: SettlementStatus.FAILED, estimatedProcessingTime: 'N/A' }),
      message: reason,
    };
  }
}