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
  const plannedAllocations = data.metadata?.settlementPlan?.allocations;
  const suppliers = Array.isArray(plannedAllocations)
    ? plannedAllocations
    : Array.isArray(data.suppliers)
      ? data.suppliers
      : [];
  const hasAllocations = suppliers.length > 0;
  const allocatedSupplierAmount = suppliers.reduce((sum: number, supplier: any) => (
    supplier.supplierMerchantId == null || !String(supplier.supplierMerchantId).trim()
      ? sum
      : sum + Number(supplier.supplierTotalAmount ?? 0)
  ), 0);
  const allocatedRetailerAmount = suppliers.reduce(
    (sum: number, supplier: any) => sum + Number(supplier.retailerTotalAmount ?? 0),
    0,
  );
  const allocatedSystemAmount = suppliers.reduce(
    (sum: number, supplier: any) => sum + Number(supplier.platformFee ?? 0),
    0,
  );
  return {
    settlementId: primarySettlement.id,
    merchantId: retailerMerchantId,
    status: options.status,
    amount,
    retailerAmount: options.retailerAmount ?? (hasAllocations ? allocatedRetailerAmount : 0),
    supplierAmount: options.supplierAmount ?? (hasAllocations ? allocatedSupplierAmount : amount),
    systemAmount: options.systemAmount ?? (hasAllocations ? allocatedSystemAmount : 0),
    paymentDetails: toPublicPaymentDetails(data.paymentMethod),
    currency: data.currency,
    reference: primarySettlement.reference,
    createdAt: primarySettlement.createdAt,
    estimatedProcessingTime: options.estimatedProcessingTime,
  };
}