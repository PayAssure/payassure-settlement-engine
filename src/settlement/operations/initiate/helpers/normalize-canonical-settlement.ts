import type { InitiateSettlementDto } from '../../../dto/initiate-settlement.dto';
import { applyCanonicalPlatformFees } from './apply-canonical-platform-fees';
import { groupCanonicalItems } from './group-canonical-items';
import { roundMoney } from './round-money';
import { validateCanonicalSettlement } from './validate-canonical-settlement';

export function normalizeCanonicalSettlement(data: InitiateSettlementDto): InitiateSettlementDto {
  const isCanonicalRequest = data.amount !== undefined || data.payment !== undefined || data.items !== undefined;
  if (!isCanonicalRequest) return data;

  const totalAmount = validateCanonicalSettlement(data);
  const { suppliers, commercialTotal } = groupCanonicalItems(data.items ?? []);
  const fee = applyCanonicalPlatformFees(suppliers, totalAmount);
  const paymentMethods = data.payment?.methods?.map((method) => ({
    type: method.type,
    amount: method.amount,
    provider: (method.type === 'CASH' ? 'ESCROW' : 'MPESA') as 'ESCROW' | 'MPESA',
    payerPhoneNumber: method.phoneNumber ?? '',
    phoneNumber: method.phoneNumber ?? '',
  }));
  const normalizedPaymentMethods = paymentMethods ?? [];
  const settlementMethod = data.settlementMethod || (
    normalizedPaymentMethods.length > 0 && normalizedPaymentMethods.every((method) => method.type === 'MPESA')
      ? 'MPESA'
      : normalizedPaymentMethods.some((method) => method.type === 'MPESA')
        ? 'MIXED'
        : 'CASH_ESCROW'
  );

  return {
    ...data,
    totalAmount,
    settlementMethod,
    transactionDate: new Date().toISOString(),
    paymentMethod: paymentMethods?.[0]
      ? { ...paymentMethods[0], type: paymentMethods[0].type as 'MPESA' | 'CASH' }
      : data.paymentMethod,
    paymentMethods,
    suppliers,
    metadata: {
      ...(data.metadata ?? {}),
      calculatedAllocation: {
        commercialTotal: roundMoney(commercialTotal),
        supplierFeeShare: fee.supplierFeeShare,
        retailerFeeShare: fee.retailerFeeShare,
        platformFee: fee.platformFee,
        platformFeeRate: fee.configuredFeeRate,
      },
    },
  };
}