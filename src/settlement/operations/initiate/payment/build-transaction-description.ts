import type { InitiateSettlementDto } from '../../../dto/initiate-settlement.dto';

export function buildTransactionDescription(data: InitiateSettlementDto): string {
  const isGoods = Array.isArray(data.suppliers) && data.suppliers.some(
    (supplier) => Array.isArray(supplier.items) && supplier.items.length > 0,
  );
  return isGoods ? 'Goods payment' : 'Settlement payment';
}