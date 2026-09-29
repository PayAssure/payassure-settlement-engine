import type { InitiateSettlementDto } from '../../../dto/initiate-settlement.dto';

export function normalizePaymentMethods(data: InitiateSettlementDto) {
  const explicitMethods = Array.isArray(data.paymentMethods) && data.paymentMethods.length > 0
    ? data.paymentMethods
    : [];

  if (explicitMethods.length > 0) {
    return explicitMethods.map((payment) => ({
      type: payment.type,
      amount: Number(payment.amount ?? 0),
      provider: payment.provider,
      payerPhoneNumber: payment.payerPhoneNumber ?? payment.phoneNumber ?? '',
      phoneNumber: payment.phoneNumber ?? payment.payerPhoneNumber ?? '',
    }));
  }

  if (!data.paymentMethod) return [];

  return [{
    type: data.paymentMethod.type,
    amount: Number(data.paymentMethod.amount ?? data.totalAmount ?? 0),
    provider: data.paymentMethod.provider,
    payerPhoneNumber: data.paymentMethod.payerPhoneNumber ?? data.paymentMethod.phoneNumber ?? '',
    phoneNumber: data.paymentMethod.phoneNumber ?? data.paymentMethod.payerPhoneNumber ?? '',
  }];
}