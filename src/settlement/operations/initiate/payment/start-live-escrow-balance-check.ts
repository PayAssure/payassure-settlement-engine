import { SettlementStatus } from '@prisma/client';
import { retailerEscrowTransferService } from '../../../../retailer';
import { buildSettlementResult } from '../helpers/build-settlement-result';
import type { SettlementInitiationContext } from '../context';

export async function startLiveEscrowBalanceCheck(
  context: SettlementInitiationContext,
  amounts: { cashAmount: number; mpesaAmount: number; mpesaPayerPhoneNumber: string; hasLiveEscrowFloat: boolean },
) {
  const { data, repository, logger, primarySettlement, retailerMerchantId } = context;
  const { cashAmount, mpesaAmount, mpesaPayerPhoneNumber, hasLiveEscrowFloat } = amounts;

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
      mpesaAmount,
      mpesaStatus: mpesaAmount > 0 ? 'WAITING_FOR_ESCROW_BALANCE' : 'NOT_REQUIRED',
    },
    escrowFunding: {
      provider: 'MPESA_ESCROW',
      status: 'BALANCE_PENDING',
      retailerMerchantId,
      cashAmount,
      mpesaAmount,
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
      mpesaAmount,
      provider: 'MPESA_RETAILER_ESCROW',
    });
    const balanceCheck = await retailerEscrowTransferService.startForSettlement({
      settlementId: primarySettlement.id,
      merchantTransactionReference: data.merchantTransactionReference,
      retailerMerchantId,
      cashAmount,
      mpesaAmount,
      mpesaPayerPhone: mpesaPayerPhoneNumber || undefined,
    });
    logger.log('[CASH_FLOW][ESCROW_BALANCE_CHECK][REQUESTED]', {
      settlementId: primarySettlement.id,
      transferId: balanceCheck.transferId,
      retailerMerchantId,
      status: balanceCheck.status,
      provider: 'MPESA_RETAILER_ESCROW',
    });
    return {
      success: true,
      settlement: buildSettlementResult(context, {
        status: SettlementStatus.PENDING_PROCESSING,
        estimatedProcessingTime: 'Awaiting M-Pesa escrow balance callback',
      }),
      message: 'Escrow balance verification was requested. CASH transfer and settlement splitting will proceed only after the balance and any MPESA funding callbacks are confirmed.',
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