export function toPublicPaymentDetails(payment: any) {
  if (!payment || !payment.type) return undefined;

  const base: any = {
    type: payment.type,
    accountName: payment.accountName ?? undefined,
    provider: payment.provider ?? undefined,
  };

  if (payment.type === 'MPESA') {
    return { ...base, phoneNumber: payment.phoneNumber ?? payment.payerPhoneNumber ?? undefined };
  }

  if (payment.type === 'BANK') {
    return {
      ...base,
      bankCode: payment.bankCode ?? undefined,
      accountNumber: payment.accountNumber ?? undefined,
      shortcode: payment.shortcode ?? undefined,
    };
  }

  return base;
}