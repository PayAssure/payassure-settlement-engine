import { Prisma, SettlementStatus } from '@prisma/client';
import { prisma } from '../../../../common/database/prisma';

export type EscrowJsonRecord = Record<string, unknown>;

export async function failEscrowTransfer(
  transferId: string,
  reason: string,
  status: string,
  callback?: EscrowJsonRecord,
  observedBalance?: number,
  callbackType: 'balance' | 'transfer' = 'balance',
): Promise<void> {
  await prisma.$transaction(async (tx) => {
    const transfer = await tx.retailerEscrowTransfer.findUnique({ where: { id: transferId } });
    if (!transfer || ['FAILED', 'BALANCE_MISMATCH', 'SUCCEEDED'].includes(transfer.status)) return;
    await tx.retailerEscrowTransfer.update({
      where: { id: transferId },
      data: {
        status,
        failureReason: reason,
        ...(callback && callbackType === 'balance' ? { balanceCallback: callback as Prisma.InputJsonValue } : {}),
        ...(callback && callbackType === 'transfer' ? { transferCallback: callback as Prisma.InputJsonValue } : {}),
        ...(observedBalance === undefined ? {} : { observedBalance: new Prisma.Decimal(observedBalance) }),
      },
    });
    await tx.retailerEscrowFloat.updateMany({
      where: { id: transfer.retailerEscrowFloatId, activeTransferId: transferId },
      data: { activeTransferId: null },
    });
    await updateEscrowSettlementMetadata(transfer.settlementId, {
      escrowStatus: status,
      escrowFailureReason: reason,
      ...(observedBalance === undefined ? {} : { observedBalance }),
    }, tx, SettlementStatus.FAILED);
  });
}

export async function updateEscrowSettlementMetadata(
  settlementId: string,
  update: EscrowJsonRecord,
  tx: any = prisma,
  status?: SettlementStatus,
): Promise<void> {
  const settlement = await tx.settlement.findUnique({ where: { id: settlementId } });
  if (!settlement) return;
  const metadata = settlement.metadata && typeof settlement.metadata === 'object' && !Array.isArray(settlement.metadata)
    ? settlement.metadata as EscrowJsonRecord
    : {};
  const escrowFunding = metadata.escrowFunding && typeof metadata.escrowFunding === 'object'
    ? metadata.escrowFunding as EscrowJsonRecord
    : {};
  await tx.settlement.update({
    where: { id: settlementId },
    data: {
      ...(status ? { status, failedAt: new Date() } : {}),
      metadata: {
        ...metadata,
        escrowFunding: { ...escrowFunding, ...update },
      } as Prisma.InputJsonValue,
    },
  });
}
