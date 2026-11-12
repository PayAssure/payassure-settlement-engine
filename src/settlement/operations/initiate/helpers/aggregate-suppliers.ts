import type { InitiateSettlementDto } from '../../../dto/initiate-settlement.dto';

export function aggregateSuppliers(suppliers: InitiateSettlementDto['suppliers']) {
  const grouped = new Map<string | null, any>();

  for (const supplier of suppliers ?? []) {
    const supplierId = supplier.supplierMerchantId == null ? null : String(supplier.supplierMerchantId).trim() || null;
    const items = Array.isArray(supplier.items) ? supplier.items : [];

    const existing = grouped.get(supplierId);
    if (!existing) {
      const directSupplierTotal = supplierId === null
        ? 0
        : Number(supplier.supplierTotalAmount ?? 0);
      const directRetailerTotal = supplierId === null
        ? (items.length > 0
            ? items.reduce((sum, item) => sum + Number(item.supplierAmount ?? 0) + Number(item.retailerAmount ?? 0), 0)
            : Number(supplier.supplierTotalAmount ?? 0) + Number(supplier.retailerTotalAmount ?? 0))
        : Number(supplier.retailerTotalAmount ?? 0);

      grouped.set(supplierId, {
        ...supplier,
        supplierMerchantId: supplierId,
        supplierTotalAmount: directSupplierTotal,
        retailerTotalAmount: directRetailerTotal,
        platformFee: Number(supplier.platformFee ?? 0),
        isDirectSettlement: supplierId === null,
        items: [...items],
      });
      continue;
    }

    existing.supplierTotalAmount += supplierId === null ? 0 : Number(supplier.supplierTotalAmount ?? 0);
    existing.retailerTotalAmount += supplierId === null
      ? (items.length > 0
          ? items.reduce((sum, item) => sum + Number(item.supplierAmount ?? 0) + Number(item.retailerAmount ?? 0), 0)
          : Number(supplier.supplierTotalAmount ?? 0) + Number(supplier.retailerTotalAmount ?? 0))
      : Number(supplier.retailerTotalAmount ?? 0);
    existing.platformFee += Number(supplier.platformFee ?? 0);
    existing.items.push(...items);
  }

  return Array.from(grouped.values());
}