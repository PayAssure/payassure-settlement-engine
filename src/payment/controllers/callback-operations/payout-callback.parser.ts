export function toPayoutCallback(payload: Record<string, unknown>): Record<string, any> | null {
  const result = payload?.Result as Record<string, any> | undefined;
  if (!result || !result.OriginatorConversationID) return null;
  const resultCode = Number(result.ResultCode ?? -1);
  const resultParameters = result.ResultParameters?.ResultParameter;
  const parameters = Array.isArray(resultParameters)
    ? resultParameters
    : resultParameters && typeof resultParameters === 'object'
      ? [resultParameters]
      : [];
  const parameterValue = (key: string) => {
    const parameter = parameters.find((item: any) => item?.Key === key);
    return parameter?.Value ?? null;
  };
  return {
    reference: String(result.OriginatorConversationID),
    transactionId: result.TransactionID ?? null,
    providerReference: result.TransactionID ?? null,
    merchantTransactionReference: String(result.OriginatorConversationID),
    status: resultCode === 0 ? 'SUCCESS' : 'FAILED',
    amount: parameterValue('TransactionAmount'),
    resultCode,
    resultDescription: result.ResultDesc ?? null,
    metadata: {
      rawResult: result,
      conversationId: result.ConversationID ?? null,
      resultType: result.ResultType ?? null,
    },
  };
}
