import { toPublicPaymentDetails } from './to-public-payment-details';

export async function findExistingSettlementResponse(
  repository: any,
  businessId: string,
  retailerMerchantId: string,
  sessionId: string,
  data: any,
) {
  const existingSettlement = await repository.findSettlementByBusinessAndPayloadReference(
    businessId,
    data.merchantTransactionReference,
  );
  if (!existingSettlement) return undefined;

  await repository.touchSession(sessionId);
  const transactions = Array.isArray(existingSettlement.transactions)
    ? existingSettlement.transactions.map((txn: any) => ({
        transactionId: txn.id,
        itemId: txn.itemId,
        type: txn.type,
        amount: Number(txn.amount),
        description: txn.description ?? undefined,
        status: txn.status,
      }))
    : [];

  return {
    success: true,
    settlement: {
      settlementId: existingSettlement.id,
      merchantId: retailerMerchantId,
      status: existingSettlement.status,
      amount: Number(existingSettlement.amount),
      retailerAmount: existingSettlement.retailerAmount ?? 0,
      supplierAmount: existingSettlement.supplierAmount ?? Number(existingSettlement.amount),
      systemAmount: existingSettlement.systemAmount ?? 0,
      paymentDetails: toPublicPaymentDetails(data.paymentMethod),
      currency: existingSettlement.currency,
      reference: existingSettlement.reference,
      createdAt: existingSettlement.createdAt,
      estimatedProcessingTime: '10 minutes',
      transactions,
    },
    message: 'Settlement already processed for this merchant transaction reference',
  };
}