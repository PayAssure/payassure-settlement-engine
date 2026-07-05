import { NotFoundException } from '@nestjs/common';

export async function trackOperation(prisma: any, repository: any, settlementId: string) {
  const settlement = await repository.findSettlementById(settlementId);
  if (!settlement) {
    throw new NotFoundException({ statusCode: 404, message: 'Settlement not found', error: 'SETTLEMENT_NOT_FOUND' });
  }

  const participant = await prisma.onboardingParticipant.findUnique({ where: { id: settlement.businessId } });

  return {
    success: true,
    settlement: {
      settlementId: settlement.id,
      businessId: settlement.businessId,
      businessName: participant?.businessName,
      status: settlement.status,
      amount: Number(settlement.amount),
      currency: settlement.currency,
      reference: settlement.reference,
      createdAt: settlement.createdAt,
      processedAt: settlement.processedAt ?? undefined,
      estimatedCompletionTime: new Date(settlement.createdAt.getTime() + 48 * 60 * 60 * 1000),
      transactions: settlement.transactions.map((txn: any) => ({
        transactionId: txn.id,
        itemId: txn.itemId,
        type: txn.type,
        amount: Number(txn.amount),
        description: txn.description ?? undefined,
        status: txn.status,
      })),
    },
  };
}
