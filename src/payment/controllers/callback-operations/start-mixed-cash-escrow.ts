import { Logger } from '@nestjs/common';
import { Prisma, SettlementStatus } from '@prisma/client';
import { prisma } from '../../../common/database/prisma';
import { retailerEscrowTransferService } from '../../../retailer';

export async function startMixedCashEscrowAfterMpesa(
  merchantTransactionReference: string,
  logger: Pick<Logger, 'log' | 'error'>,
) {
  const settlement = await prisma.settlement.findFirst({
    where: { merchantTransactionReference },
    select: { id: true, metadata: true },
  });
  if (!settlement) return;

  const metadata = settlement.metadata && typeof settlement.metadata === 'object' && !Array.isArray(settlement.metadata)
    ? settlement.metadata as Record<string, unknown>
    : {};
  const fundingPlan = metadata.fundingPlan && typeof metadata.fundingPlan === 'object' && !Array.isArray(metadata.fundingPlan)
    ? metadata.fundingPlan as Record<string, unknown>
    : {};
  const cashAmount = Number(fundingPlan.cashAmount ?? 0);
  const mpesaAmount = Number(fundingPlan.mpesaAmount ?? 0);
  const retailerMerchantId = String(fundingPlan.retailerMerchantId ?? '');
  if (cashAmount <= 0 || mpesaAmount <= 0 || !retailerMerchantId) return;

  const existingTransfer = await prisma.retailerEscrowTransfer.findUnique({ where: { settlementId: settlement.id } });
  if (existingTransfer) return;
  if (fundingPlan.mpesaStatus !== 'WAITING_FOR_CUSTOMER' && fundingPlan.mpesaStatus !== 'SUCCESS') return;

  const updatedMetadata = {
    ...metadata,
    fundingPlan: {
      ...fundingPlan,
      mpesaStatus: 'SUCCESS',
      cashStatus: 'STARTING',
    },
  };
  await prisma.settlement.update({
    where: { id: settlement.id },
    data: {
      status: SettlementStatus.PENDING_PROCESSING,
      metadata: updatedMetadata as Prisma.InputJsonValue,
    },
  });

  try {
    const transfer = await retailerEscrowTransferService.startForSettlement({
      settlementId: settlement.id,
      merchantTransactionReference,
      retailerMerchantId,
      cashAmount,
      mpesaAmount: 0,
    });
    if (transfer.accepted === false) {
      throw new Error(String(transfer.reason ?? 'Retailer cash escrow transfer was not accepted'));
    }

    const currentSettlement = await prisma.settlement.findUnique({
      where: { id: settlement.id },
      select: { metadata: true },
    });
    const currentMetadata = currentSettlement?.metadata && typeof currentSettlement.metadata === 'object' && !Array.isArray(currentSettlement.metadata)
      ? currentSettlement.metadata as Record<string, unknown>
      : updatedMetadata;
    const currentFundingPlan = currentMetadata.fundingPlan && typeof currentMetadata.fundingPlan === 'object' && !Array.isArray(currentMetadata.fundingPlan)
      ? currentMetadata.fundingPlan as Record<string, unknown>
      : updatedMetadata.fundingPlan;
    await prisma.settlement.update({
      where: { id: settlement.id },
      data: {
        metadata: {
          ...currentMetadata,
          fundingPlan: {
            ...currentFundingPlan,
            cashStatus: transfer.status ?? 'BALANCE_VERIFIED',
          },
        } as Prisma.InputJsonValue,
      },
    });
    logger.log('[CASH_FLOW][ESCROW_BALANCE][VERIFIED_AFTER_MPESA]', {
      settlementId: settlement.id,
      merchantTransactionReference,
      cashAmount,
      transferId: transfer.transferId,
      status: transfer.status,
    });
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    await prisma.settlement.update({
      where: { id: settlement.id },
      data: {
        status: SettlementStatus.FAILED,
        failedAt: new Date(),
        metadata: {
          ...metadata,
          fundingPlan: { ...fundingPlan, cashStatus: 'FAILED', reason },
        } as Prisma.InputJsonValue,
      },
    });
    logger.error('[CASH_FLOW][ESCROW_TRANSFER][FAILED_AFTER_MPESA]', {
      settlementId: settlement.id,
      merchantTransactionReference,
      cashAmount,
      error: reason,
    });
    throw error;
  }
}
