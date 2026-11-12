import { roundMoney } from './round-money';

export function applyCanonicalPlatformFees(suppliers: any[], totalAmount: number) {
  const configuredFeeRate = Number(process.env.PAYASSURE_PLATFORM_FEE_RATE ?? 0.8);
  const calculatedPlatformFee = roundMoney(totalAmount * (Number.isFinite(configuredFeeRate) ? configuredFeeRate : 0.8) / 100);
  const supplierFeeShare = roundMoney(calculatedPlatformFee / 2);
  const retailerFeeShare = roundMoney(calculatedPlatformFee - supplierFeeShare);
  const supplierCommercialTotal = suppliers.reduce((sum, supplier) => sum + supplier.supplierTotalAmount, 0);
  const retailerCommercialTotal = suppliers.reduce((sum, supplier) => sum + supplier.retailerTotalAmount, 0);
  let platformFee = 0;

  for (const supplier of suppliers) {
    const supplierShare = supplierCommercialTotal > 0 ? supplier.supplierTotalAmount / supplierCommercialTotal : 0;
    const retailerShare = retailerCommercialTotal > 0 ? supplier.retailerTotalAmount / retailerCommercialTotal : 0;
    const supplierDeduction = supplierCommercialTotal > 0 ? roundMoney(supplierFeeShare * supplierShare) : 0;
    const retailerFeePool = supplierCommercialTotal > 0 ? retailerFeeShare : calculatedPlatformFee;
    const retailerDeduction = roundMoney(retailerFeePool * retailerShare);

    const items = Array.isArray(supplier.items) ? supplier.items : [];
    const supplierItemTotal = items.reduce((sum: number, item: any) => sum + Number(item.supplierAmount ?? 0), 0);
    const retailerItemTotal = items.reduce((sum: number, item: any) => sum + Number(item.retailerAmount ?? 0), 0);
    let supplierAmount = 0;
    let retailerAmount = 0;
    let fractionalRemainder = 0;

    for (const item of items) {
      const supplierItemShare = supplierItemTotal > 0 ? item.supplierAmount / supplierItemTotal : 0;
      const retailerItemShare = retailerItemTotal > 0 ? item.retailerAmount / retailerItemTotal : 0;
      const netSupplierAmount = roundMoney(Number(item.supplierAmount ?? 0) - supplierDeduction * supplierItemShare);
      const netRetailerAmount = roundMoney(Number(item.retailerAmount ?? 0) - retailerDeduction * retailerItemShare);
      item.supplierAmount = Math.floor(netSupplierAmount + Number.EPSILON);
      item.retailerAmount = Math.floor(netRetailerAmount + Number.EPSILON);
      supplierAmount += item.supplierAmount;
      retailerAmount += item.retailerAmount;
      fractionalRemainder = roundMoney(
        fractionalRemainder
          + netSupplierAmount - item.supplierAmount
          + netRetailerAmount - item.retailerAmount,
      );
    }

    supplier.supplierTotalAmount = supplierAmount;
    supplier.retailerTotalAmount = retailerAmount;
    supplier.platformFee = roundMoney(supplierDeduction + retailerDeduction + fractionalRemainder);
    platformFee = roundMoney(platformFee + supplier.platformFee);
  }

  const allocatedAmount = suppliers.reduce(
    (sum, supplier) => sum + Number(supplier.supplierTotalAmount ?? 0) + Number(supplier.retailerTotalAmount ?? 0),
    0,
  );
  const retainedPlatformFee = roundMoney(totalAmount - allocatedAmount);
  const roundingAdjustment = roundMoney(retainedPlatformFee - platformFee);
  if (suppliers.length > 0 && roundingAdjustment !== 0) {
    const lastSupplier = suppliers[suppliers.length - 1];
    lastSupplier.platformFee = roundMoney(lastSupplier.platformFee + roundingAdjustment);
  }

  return {
    platformFee: retainedPlatformFee,
    supplierFeeShare,
    retailerFeeShare,
    configuredFeeRate,
  };
}