import { BadRequestException } from '@nestjs/common';
import type { InitiateSettlementDto } from '../../../dto/initiate-settlement.dto';
import { roundMoney } from './round-money';
import { calculateCanonicalItemAmounts } from './calculate-canonical-item-amounts';

export function validateCanonicalSettlement(data: InitiateSettlementDto): number {
  const errors: string[] = [];
  if (!data.merchantId) errors.push('merchantId is required');
  if (!data.merchantTransactionReference) errors.push('merchantTransactionReference is required');
  if (!data.amount || data.amount <= 0) errors.push('amount must be greater than 0');
  if (!data.currency) errors.push('currency is required');
  if (!data.payment?.methods?.length) errors.push('payment.methods is required and must contain at least one method');
  if (!data.items?.length) errors.push('items is required and must contain at least one item');

  if (errors.length > 0) {
    throw new BadRequestException({
      statusCode: 400,
      message: 'Canonical settlement payload is incomplete',
      error: 'CANONICAL_PAYLOAD_REQUIRED',
      errors: errors.map((message) => ({ field: message.split(' ')[0], message })),
    });
  }

  const totalAmount = Number(data.amount ?? data.totalAmount ?? 0);
  const fundingTotal = roundMoney((data.payment?.methods ?? []).reduce((sum, method) => sum + Number(method.amount), 0));
  const commercialTotal = (data.items ?? []).reduce((sum, item) => (
    roundMoney(sum + calculateCanonicalItemAmounts(item).lineAmount)
  ), 0);

  if (fundingTotal !== totalAmount || commercialTotal !== totalAmount) {
    throw new BadRequestException({
      statusCode: 400,
      message: 'Canonical settlement amounts do not reconcile',
      error: 'CANONICAL_AMOUNT_MISMATCH',
      errors: [
        ...(fundingTotal !== totalAmount ? [{ field: 'payment.methods', message: `Payment methods total ${fundingTotal} does not equal amount ${totalAmount}` }] : []),
        ...(commercialTotal !== totalAmount ? [{ field: 'items', message: `Supplier and retailer item allocations total ${commercialTotal} does not equal amount ${totalAmount}` }] : []),
      ],
    });
  }

  return totalAmount;
}