export function normalizeMpesaResponse(
  response: Record<string, unknown>,
  operation: string,
  conversationIdFallback?: string,
): Record<string, unknown> {
  const responseCode = response.ResponseCode ?? response.responseCode ?? 'UNKNOWN';
  return {
    responseCode,
    responseDescription: response.ResponseDescription ?? response.responseDescription ?? `Unknown M-Pesa ${operation} response`,
    originatorConversationId: response.OriginatorConversationID ?? response.originatorConversationId,
    conversationId: response.ConversationID ?? response.conversationId ?? conversationIdFallback,
    timestamp: new Date().toISOString(),
    success: String(responseCode) === '0',
  };
}