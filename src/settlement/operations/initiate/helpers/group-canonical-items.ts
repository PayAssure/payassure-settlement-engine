import type { InitiateSettlementDto } from '../../../dto/initiate-settlement.dto';
import { roundMoney } from './round-money';
import { calculateCanonicalItemAmounts } from './calculate-canonical-item-amounts';

export function groupCanonicalItems(items: NonNullable<InitiateSettlementDto['items']>) {
  const supplierGroups = new Map<string, any>();
  let commercialTotal = 0;

  for (const item of items) {
    const { supplierAmount, retailerAmount, lineAmount } = calculateCanonicalItemAmounts(item);
    commercialTotal = roundMoney(commercialTotal + lineAmount);
    const existing = supplierGroups.get(item.supplierMerchantId) ?? {
      supplierMerchantId: item.supplierMerchantId,
      supplierTotalAmount: 0,
      retailerTotalAmount: 0,
      platformFee: 0,
      items: [],
    };
    existing.supplierTotalAmount = roundMoney(existing.supplierTotalAmount + supplierAmount);
    existing.retailerTotalAmount = roundMoney(existing.retailerTotalAmount + retailerAmount);
    existing.items.push({ itemReference: item.itemReference, supplierAmount, retailerAmount });
    supplierGroups.set(item.supplierMerchantId, existing);
  }

  return { suppliers: Array.from(supplierGroups.values()), commercialTotal };
}