import { NotFoundException } from '@nestjs/common';

export async function reconcileOperation(repository: any, data: any) {
  const settlement = await repository.findSettlementById(data.settlementId);
  if (!settlement) {
    throw new NotFoundException({ statusCode: 404, message: 'Settlement not found', error: 'SETTLEMENT_NOT_FOUND' });
  }

  const updatedSettlement = await repository.updateSettlementReconciliation(data.settlementId, data.bankReference, data.bankTransactionId);

  return {
    success: true,
    settlement: {
      settlementId: updatedSettlement.id,
      status: updatedSettlement.status,
      reconciliationStatus: updatedSettlement.reconciliationStatus ?? undefined,
      reconciliationDetails: {
        bankReference: updatedSettlement.bankReference ?? '',
        reconcileAt: updatedSettlement.reconciliedAt ?? updatedSettlement.completedAt ?? updatedSettlement.createdAt,
      },
    },
  };
}
