import { roundMoney } from './round-money';

export function calculateCanonicalItemAmounts(item: {
  supplierAmount?: number;
  retailerAmount?: number;
}) {
  const supplierAmount = roundMoney(Number(item.supplierAmount ?? 0));
  const retailerAmount = roundMoney(Number(item.retailerAmount ?? 0));
  return {
    supplierAmount,
    retailerAmount,
    lineAmount: roundMoney(supplierAmount + retailerAmount),
  };
}