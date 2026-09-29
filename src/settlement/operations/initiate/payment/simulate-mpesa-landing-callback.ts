export function simulateMpesaLandingCallback(options: {
  merchantTransactionReference: string;
  amount: number;
  payerPhoneNumber?: string;
  provider?: string;
  stkPushInitiated?: boolean;
}) {
  const amount = Number(options.amount ?? 0);
  const callbackConfirmed = Boolean(options.stkPushInitiated ?? false);

  return {
    status: callbackConfirmed ? 'SUCCESS' : 'BLOCKED',
    merchantTransactionReference: options.merchantTransactionReference,
    amount,
    provider: options.provider ?? 'MPESA',
    payerPhoneNumber: options.payerPhoneNumber ?? '',
    receiptNumber: `SIM-${options.merchantTransactionReference}-${Date.now()}`,
    callbackConfirmed,
    depositedAt: new Date().toISOString(),
    message: callbackConfirmed
      ? 'MPESA callback simulated successfully after STK push was initiated; funds are assumed to have landed in PayAssure.'
      : 'MPESA callback simulation skipped because no STK push was initiated.',
  };
}