import type { SettlementStatus } from '@prisma/client';
import { toPublicPaymentDetails } from './to-public-payment-details';
import type { SettlementInitiationContext } from '../context';

export function buildSettlementResult(
  context: SettlementInitiationContext,
  options: {
    status: SettlementStatus;
    estimatedProcessingTime: string;
    retailerAmount?: number;
    supplierAmount?: number;
    systemAmount?: number;
  },
) {
  const { data, primarySettlement, retailerMerchantId } = context;
  const amount = Number(data.totalAmount);
  return {
    settlementId: primarySettlement.id,
    merchantId: retailerMerchantId,
    status: options.status,
    amount,
    retailerAmount: options.retailerAmount ?? 0,
    supplierAmount: options.supplierAmount ?? amount,
    systemAmount: options.systemAmount ?? 0,
    paymentDetails: toPublicPaymentDetails(data.paymentMethod),
    currency: data.currency,
    reference: primarySettlement.reference,
    createdAt: primarySettlement.createdAt,
    estimatedProcessingTime: options.estimatedProcessingTime,
  };
}