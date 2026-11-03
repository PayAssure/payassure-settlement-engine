import type PaymentCallbackDto from '../../../settlement/dto/payment-callback.dto';
import type { ParsedStkCallback } from '../../utils/mpesa-callback.util';

type PaymentCallbackHandler = {
  handlePaymentCallback(data: PaymentCallbackDto): Promise<any>;
};

export function recordFailedCollection(
  settlementService: PaymentCallbackHandler,
  merchantTransactionReference: string,
  parsed: ParsedStkCallback,
) {
  return settlementService.handlePaymentCallback({
    merchantTransactionReference,
    status: 'FAILED',
    provider: 'M-PESA',
    providerReference: parsed.receipt ?? undefined,
    amount: parsed.amount && Number.isFinite(Number(parsed.amount)) ? Number(parsed.amount) : undefined,
    currency: 'KES',
    metadata: {
      resultCode: parsed.resultCode,
      resultDescription: parsed.resultDesc,
    },
  });
}
