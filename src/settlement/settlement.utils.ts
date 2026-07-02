export interface SupplierSettlementItem {
  itemId: string;
  supplierMerchantId: string;
  type: string;
  quantity?: number;
  unitPrice?: number;
  amount: number;
  description?: string;
}

export interface SupplierSettlementGroup {
  supplierMerchantId: string;
  amount: number;
  items: SupplierSettlementItem[];
}

export function groupTransactionItemsBySupplier(items: SupplierSettlementItem[]): SupplierSettlementGroup[] {
  const groups = new Map<string, SupplierSettlementGroup>();

  for (const item of items) {
    const supplierMerchantId = item.supplierMerchantId;
    const existing = groups.get(supplierMerchantId);

    if (existing) {
      existing.amount += item.amount;
      existing.items.push(item);
      continue;
    }

    groups.set(supplierMerchantId, {
      supplierMerchantId,
      amount: item.amount,
      items: [item],
    });
  }

  return Array.from(groups.values());
}
