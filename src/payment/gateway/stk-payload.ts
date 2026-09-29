import { buildPassword } from './environment';

export function buildStkPayload(options: {
  shortcode: string;
  passkey: string;
  timestamp: string;
  formattedNumber: string;
  amount: string | number;
  accountReference?: string;
  transactionDesc?: string;
}): Record<string, unknown> {
  const callbackUrl = process.env.MPESA_CALLBACK_URL ?? 'http://localhost:3000/callbacks/mpesa';
  return {
    BusinessShortCode: options.shortcode,
    Password: buildPassword(options.shortcode, options.passkey, options.timestamp),
    Timestamp: options.timestamp,
    TransactionType: 'CustomerPayBillOnline',
    Amount: Math.round(Number(options.amount)),
    PartyA: options.formattedNumber,
    PartyB: options.shortcode,
    PhoneNumber: options.formattedNumber,
    CallBackURL: callbackUrl,
    AccountReference: options.accountReference || 'Payassure',
    TransactionDesc: options.transactionDesc || 'payment for goods',
  };
}
