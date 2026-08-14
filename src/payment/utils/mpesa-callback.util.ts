export interface ParsedStkCallback {
  merchantRequestId: string | null;
  amount: string | null;
  receipt: string | null;
  checkoutRequestId: string | null;
  status: 'completed' | 'failed';
  resultCode: number | null;
  resultDesc: string | null;
  transactionDate: string | null;
  phoneNumber: string | null;
  rawCallback: Record<string, unknown>;
}

export function parseStkCallback(payload: Record<string, unknown>): ParsedStkCallback {
  const result = (payload?.Result as Record<string, unknown> | undefined) ?? null;
  if (result) {
    const resultParameters = (result?.ResultParameters as Record<string, unknown> | undefined)?.ResultParameter as Array<Record<string, unknown>> | undefined;
    const paramValue = (key: string): string | null => {
      const entry = resultParameters?.find((item) => item?.Key === key);
      const value = entry?.Value;
      return value == null ? null : String(value);
    };

    const checkoutRequestId = (result?.ConversationID as string | undefined) ?? null;
    const resultCode = Number(result?.ResultCode ?? -1);
    const resultDesc = (result?.ResultDesc as string | undefined) ?? null;

    return {
      merchantRequestId: null,
      amount: paramValue('TransactionAmount'),
      receipt: paramValue('TransactionReceipt'),
      checkoutRequestId,
      status: resultCode === 0 ? 'completed' : 'failed',
      resultCode,
      resultDesc,
      transactionDate: paramValue('TransactionCompletedDateTime'),
      phoneNumber: paramValue('ReceiverPartyPublicName') ?? null,
      rawCallback: payload,
    };
  }

  const callback = (payload?.Body as Record<string, unknown> | undefined)?.stkCallback as Record<string, unknown> | undefined;
  if (!callback) {
    return {
      merchantRequestId: null,
      amount: null,
      receipt: null,
      checkoutRequestId: null,
      status: 'failed',
      resultCode: null,
      resultDesc: null,
      transactionDate: null,
      phoneNumber: null,
      rawCallback: payload,
    };
  }

  const items = Array.isArray((callback?.CallbackMetadata as Record<string, unknown> | undefined)?.Item)
    ? ((callback.CallbackMetadata as Record<string, unknown>).Item as Array<Record<string, unknown>>)
    : [];

  const findByName = (name: string): string | null => {
    const item = items.find((entry) => entry?.Name === name);
    const value = item?.Value;
    return value == null ? null : String(value);
  };

  const checkoutRequestId = (callback?.CheckoutRequestID as string | undefined) ?? null;
  const merchantRequestId = (callback?.MerchantRequestID as string | undefined) ?? null;
  const resultCode = Number(callback?.ResultCode ?? -1);
  const resultDesc = (callback?.ResultDesc as string | undefined) ?? null;

  return {
    merchantRequestId,
    amount: findByName('Amount'),
    receipt: findByName('MpesaReceiptNumber'),
    checkoutRequestId,
    status: resultCode === 0 ? 'completed' : 'failed',
    resultCode,
    resultDesc,
    transactionDate: findByName('TransactionDate'),
    phoneNumber: findByName('PhoneNumber'),
    rawCallback: payload,
  };
}
