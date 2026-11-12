import type { InitiateSettlementDto } from '../../../dto/initiate-settlement.dto';
import { roundMoney } from './round-money';
import { calculateCanonicalItemAmounts } from './calculate-canonical-item-amounts';

export function groupCanonicalItems(items: NonNullable<InitiateSettlementDto['items']>) {
  const supplierGroups = new Map<string | null, any>();
  let commercialTotal = 0;

  for (const item of items) {
    const { supplierAmount, retailerAmount, lineAmount } = calculateCanonicalItemAmounts(item);
    const normalizedSupplierId = item.supplierMerchantId == null ? null : String(item.supplierMerchantId).trim() || null;
    commercialTotal = roundMoney(commercialTotal + lineAmount);
    const existing = supplierGroups.get(normalizedSupplierId) ?? {
      supplierMerchantId: normalizedSupplierId,
      supplierTotalAmount: 0,
      retailerTotalAmount: 0,
      platformFee: 0,
      items: [],
      isDirectSettlement: normalizedSupplierId === null,
    };

    if (normalizedSupplierId === null) {
      existing.supplierTotalAmount = 0;
      existing.retailerTotalAmount = roundMoney(existing.retailerTotalAmount + lineAmount);
    } else {
      existing.supplierTotalAmount = roundMoney(existing.supplierTotalAmount + supplierAmount);
      existing.retailerTotalAmount = roundMoney(existing.retailerTotalAmount + retailerAmount);
    }

    existing.items.push({
      itemReference: item.itemReference,
      supplierAmount: normalizedSupplierId === null ? 0 : supplierAmount,
      retailerAmount: normalizedSupplierId === null ? lineAmount : retailerAmount,
    });
    supplierGroups.set(normalizedSupplierId, existing);
  }

  return { suppliers: Array.from(supplierGroups.values()), commercialTotal };
}