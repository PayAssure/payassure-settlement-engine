import type { InitiateSettlementDto } from '../../../dto/initiate-settlement.dto';

export function aggregateSuppliers(suppliers: InitiateSettlementDto['suppliers']) {
  const grouped = new Map<string, any>();

  for (const supplier of suppliers ?? []) {
    const supplierId = String(supplier.supplierMerchantId ?? '').trim();
    const items = Array.isArray(supplier.items) ? supplier.items : [];
    if (!supplierId) continue;

    const existing = grouped.get(supplierId);
    if (!existing) {
      grouped.set(supplierId, {
        ...supplier,
        supplierMerchantId: supplierId,
        supplierTotalAmount: Number(supplier.supplierTotalAmount ?? 0),
        retailerTotalAmount: Number(supplier.retailerTotalAmount ?? 0),
        platformFee: Number(supplier.platformFee ?? 0),
        items: [...items],
      });
      continue;
    }

    existing.supplierTotalAmount += Number(supplier.supplierTotalAmount ?? 0);
    existing.retailerTotalAmount += Number(supplier.retailerTotalAmount ?? 0);
    existing.platformFee += Number(supplier.platformFee ?? 0);
    existing.items.push(...items);
  }

  return Array.from(grouped.values());
}