import type { InitiateSettlementDto } from '../../../dto/initiate-settlement.dto';

export interface SettlementPlan {
  settlementMode: 'DIRECT' | 'SPLIT' | 'MIXED';
  paymentMethod: 'CASH' | 'MPESA' | 'CASH_AND_MPESA';
  cashAmount: number;
  mpesaAmount: number;
  supplierAmount: number;
  supplierPayoutAmount: number;
  retailerEntitlement: number;
  retailerCashAlreadyReceived: number;
  retailerPayoutAmount: number;
  escrowDebitAmount: number;
  escrowBalanceCheckRequired: boolean;
  supplierPayoutRequired: boolean;
  retailerPayoutRequired: boolean;
  platformFeeAmount: number;
  settlementStatus: 'SETTLED' | 'PENDING';
  allocations: Array<{
    supplierMerchantId: string | null;
    supplierTotalAmount: number;
    retailerTotalAmount: number;
    platformFee: number;
    items: Array<Record<string, any>>;
  }>;
  payoutInstructions: Array<{
    party: 'SUPPLIER' | 'RETAILER';
    supplierMerchantId?: string;
    amount: number;
    escrowFundedAmount: number;
  }>;
}

export function buildSettlementPlan(data: InitiateSettlementDto): SettlementPlan {
  const methods = Array.isArray(data.paymentMethods) && data.paymentMethods.length > 0
    ? data.paymentMethods
    : data.paymentMethod
      ? [{ ...data.paymentMethod, amount: Number(data.paymentMethod.amount ?? data.totalAmount ?? 0) }]
      : [];
  const cashAmount = methods
    .filter((method) => String(method.type).toUpperCase() === 'CASH')
    .reduce((sum, method) => sum + Number(method.amount ?? 0), 0);
  const mpesaAmount = methods
    .filter((method) => String(method.type).toUpperCase() === 'MPESA')
    .reduce((sum, method) => sum + Number(method.amount ?? 0), 0);
  const paymentMethod = cashAmount > 0 && mpesaAmount > 0
    ? 'CASH_AND_MPESA'
    : cashAmount > 0
      ? 'CASH'
      : 'MPESA';
  const supplierGroups = data.suppliers ?? [];
  const supplierAmount = supplierGroups.reduce((total, supplier) => {
    if (supplier.supplierMerchantId == null) return total;
    const items = Array.isArray(supplier.items) ? supplier.items : [];
    return total + (items.length > 0
      ? items.reduce((sum, item) => sum + Number(item.supplierAmount ?? 0), 0)
      : Number(supplier.supplierTotalAmount ?? 0));
  }, 0);
  const retailerAllocation = supplierGroups.reduce((total, supplier) => (
    total + Number(supplier.retailerTotalAmount ?? 0)
  ), 0);
  const platformFeeAmount = Number(data.metadata?.calculatedAllocation?.platformFee)
    || supplierGroups.reduce((total, supplier) => total + Number(supplier.platformFee ?? 0), 0);
  const hasDirect = supplierGroups.some((supplier) => supplier.supplierMerchantId == null);
  const hasSplit = supplierGroups.some((supplier) => supplier.supplierMerchantId != null);
  const settlementMode = data.metadata?.resolvedSettlementMode
    ?? (hasDirect && hasSplit ? 'MIXED' : hasDirect ? 'DIRECT' : 'SPLIT');
  const retailerEntitlement = settlementMode === 'DIRECT'
    ? Number(data.totalAmount ?? data.amount ?? 0)
    : retailerAllocation;
  const directCash = settlementMode === 'DIRECT' && paymentMethod === 'CASH';
  const supplierPayoutAmount = settlementMode === 'DIRECT'
    ? 0
    : paymentMethod === 'CASH'
      ? Math.min(supplierAmount, cashAmount)
      : Math.min(supplierAmount, cashAmount + mpesaAmount);
  const supplierMpesaFunding = paymentMethod === 'CASH_AND_MPESA'
    ? Math.max(0, supplierPayoutAmount - cashAmount)
    : paymentMethod === 'MPESA'
      ? supplierPayoutAmount
      : 0;
  const retailerPayoutAmount = directCash
    ? 0
    : settlementMode === 'DIRECT'
      ? Math.min(Math.max(0, retailerEntitlement - platformFeeAmount), mpesaAmount)
      : paymentMethod === 'CASH'
        ? 0
        : paymentMethod === 'CASH_AND_MPESA'
          ? Math.min(retailerAllocation, Math.max(0, mpesaAmount - supplierMpesaFunding))
          : retailerAllocation;
  const escrowDebitAmount = settlementMode === 'DIRECT'
    ? 0
    : paymentMethod === 'CASH'
      ? supplierPayoutAmount
      : Math.min(cashAmount, supplierPayoutAmount);
  const allocations = supplierGroups.map((supplier) => ({
    supplierMerchantId: supplier.supplierMerchantId == null
      ? null
      : String(supplier.supplierMerchantId).trim() || null,
    supplierTotalAmount: Number(supplier.supplierTotalAmount ?? 0),
    retailerTotalAmount: Number(supplier.retailerTotalAmount ?? 0),
    platformFee: Number(supplier.platformFee ?? 0),
    items: (Array.isArray(supplier.items) ? supplier.items : []).map((item) => ({ ...item })),
  }));
  let remainingSupplierPayout = supplierPayoutAmount;
  let remainingEscrowFunding = escrowDebitAmount;
  const payoutInstructions: SettlementPlan['payoutInstructions'] = [];
  for (const allocation of allocations) {
    if (!allocation.supplierMerchantId || remainingSupplierPayout <= 0) continue;
    const amount = Math.min(allocation.supplierTotalAmount, remainingSupplierPayout);
    const escrowFundedAmount = Math.min(amount, remainingEscrowFunding);
    remainingSupplierPayout = Math.max(0, remainingSupplierPayout - amount);
    remainingEscrowFunding = Math.max(0, remainingEscrowFunding - escrowFundedAmount);
    if (amount > 0) {
      payoutInstructions.push({
        party: 'SUPPLIER',
        supplierMerchantId: allocation.supplierMerchantId,
        amount,
        escrowFundedAmount,
      });
    }
  }
  if (retailerPayoutAmount > 0) {
    payoutInstructions.push({
      party: 'RETAILER',
      amount: retailerPayoutAmount,
      escrowFundedAmount: 0,
    });
  }

  return {
    settlementMode,
    paymentMethod,
    cashAmount,
    mpesaAmount,
    supplierAmount,
    supplierPayoutAmount,
    retailerEntitlement,
    retailerCashAlreadyReceived: directCash ? cashAmount : 0,
    retailerPayoutAmount,
    escrowDebitAmount,
    escrowBalanceCheckRequired: escrowDebitAmount > 0,
    supplierPayoutRequired: supplierPayoutAmount > 0,
    retailerPayoutRequired: retailerPayoutAmount > 0,
    platformFeeAmount,
    settlementStatus: directCash ? 'SETTLED' : 'PENDING',
    allocations,
    payoutInstructions,
  };
}
