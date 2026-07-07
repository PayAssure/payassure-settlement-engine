import { NotFoundException } from '@nestjs/common';

function buildTimeline(status: string, createdAt: Date) {
  return [
    { status: 'INITIATED', timestamp: createdAt.toISOString() },
    { status: 'ALLOCATED', timestamp: createdAt.toISOString() },
    { status: 'PENDING_PAYOUT', timestamp: createdAt.toISOString() },
  ];
}

export async function trackOperation(prisma: any, repository: any, settlementId: string, view: 'retailer' | 'supplier' | 'payassure' = 'retailer') {
  const settlement = await repository.findSettlementById(settlementId);
  if (!settlement) {
    throw new NotFoundException({ statusCode: 404, message: 'Settlement not found', error: 'SETTLEMENT_NOT_FOUND' });
  }

  const participant = await prisma.onboardingParticipant.findUnique({ where: { id: settlement.businessId } });
  const paymentMethod = settlement.paymentPayload?.paymentMethod ?? settlement.paymentSnapshot ?? {};
  const suppliers = Array.isArray(settlement.paymentPayload?.suppliers) ? settlement.paymentPayload.suppliers : [];
  const paymentType = paymentMethod?.type ?? 'UNKNOWN';
  const transactions = Array.isArray(settlement.transactions) ? settlement.transactions : [];

  const baseSettlement = {
    settlementId: settlement.id,
    reference: settlement.reference,
    merchantTransactionReference: settlement.merchantTransactionReference,
    status: settlement.status,
    currency: settlement.currency,
    createdAt: settlement.createdAt,
    processedAt: settlement.processedAt ?? undefined,
    estimatedCompletionTime: new Date(settlement.createdAt.getTime() + 48 * 60 * 60 * 1000),
    timeline: buildTimeline(settlement.status, settlement.createdAt),
  };

  if (view === 'supplier') {
    return {
      success: true,
      view,
      settlement: {
        ...baseSettlement,
        retailerMerchantId: settlement.metadata?.retailerMerchantId ?? null,
        amount: Number(settlement.amount),
        items: (suppliers[0]?.items ?? []).map((item: any) => ({
          itemReference: item.itemReference ?? item.itemId,
          supplierAmount: Number(item.supplierAmount ?? 0),
        })),
      },
    };
  }

  if (view === 'payassure') {
    return {
      success: true,
      view,
      settlement: {
        ...baseSettlement,
        businessId: settlement.businessId,
        businessName: participant?.businessName,
        amounts: {
          total: Number(settlement.amount),
          supplier: Number(settlement.amount),
          retailer: 0,
          platformFee: 0,
        },
        suppliers: suppliers.map((supplier: any) => ({
          supplierMerchantId: supplier.supplierMerchantId,
          amount: Number(supplier.supplierTotalAmount ?? 0),
          status: settlement.status,
        })),
        customerPayment: { type: paymentType },
      },
    };
  }

  return {
    success: true,
    view,
    settlement: {
      ...baseSettlement,
      businessId: settlement.businessId,
      businessName: participant?.businessName,
      amounts: {
        total: Number(settlement.amount),
        supplier: Number(settlement.amount),
        retailer: 0,
        platformFee: 0,
      },
      customerPayment: { type: paymentType },
      suppliers: suppliers.map((supplier: any) => ({
        supplierMerchantId: supplier.supplierMerchantId,
        amount: Number(supplier.supplierTotalAmount ?? 0),
        status: settlement.status,
      })),
      transactions: transactions.map((txn: any) => ({
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
