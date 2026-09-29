import { roundMoney } from './round-money';

export function applyCanonicalPlatformFees(suppliers: any[], totalAmount: number) {
  const configuredFeeRate = Number(process.env.PAYASSURE_PLATFORM_FEE_RATE ?? 0.8);
  const platformFee = roundMoney(totalAmount * (Number.isFinite(configuredFeeRate) ? configuredFeeRate : 0.8) / 100);
  const supplierFeeShare = roundMoney(platformFee / 2);
  const retailerFeeShare = roundMoney(platformFee - supplierFeeShare);
  const supplierCommercialTotal = suppliers.reduce((sum, supplier) => sum + supplier.supplierTotalAmount, 0);
  const retailerCommercialTotal = suppliers.reduce((sum, supplier) => sum + supplier.retailerTotalAmount, 0);

  for (const supplier of suppliers) {
    const supplierShare = supplierCommercialTotal > 0 ? roundMoney(supplier.supplierTotalAmount / supplierCommercialTotal) : 0;
    const retailerShare = retailerCommercialTotal > 0 ? roundMoney(supplier.retailerTotalAmount / retailerCommercialTotal) : 0;
    const supplierDeduction = roundMoney(supplierFeeShare * supplierShare);
    const retailerDeduction = roundMoney(retailerFeeShare * retailerShare);
    supplier.supplierTotalAmount = roundMoney(supplier.supplierTotalAmount - supplierDeduction);
    supplier.retailerTotalAmount = roundMoney(supplier.retailerTotalAmount - retailerDeduction);
    supplier.platformFee = roundMoney(supplierDeduction + retailerDeduction);

    const supplierItemTotal = supplier.items.reduce((sum: number, item: any) => sum + item.supplierAmount, 0);
    const retailerItemTotal = supplier.items.reduce((sum: number, item: any) => sum + item.retailerAmount, 0);
    for (const item of supplier.items) {
      const supplierItemShare = supplierItemTotal > 0 ? item.supplierAmount / supplierItemTotal : 0;
      const retailerItemShare = retailerItemTotal > 0 ? item.retailerAmount / retailerItemTotal : 0;
      item.supplierAmount = roundMoney(item.supplierAmount - supplierDeduction * supplierItemShare);
      item.retailerAmount = roundMoney(item.retailerAmount - retailerDeduction * retailerItemShare);
    }
  }

  return { platformFee, supplierFeeShare, retailerFeeShare, configuredFeeRate };
}