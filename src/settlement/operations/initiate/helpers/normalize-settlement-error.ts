export function normalizeSettlementError(error: unknown, fallbackContext?: Record<string, any>) {
  const message = error instanceof Error ? error.message : String(error ?? 'Unknown settlement error');
  const isGatewayFailure = /(fetch failed|M-Pesa|B2Pochi|gateway.*failed|ECONN|ENET|timed out|timeout|403|securitycredential)/i.test(message);

  if (isGatewayFailure) {
    return {
      statusCode: 502,
      message,
      error: 'PAYMENT_PROVIDER_ERROR',
      provider: 'M-PESA/B2POCHI',
      details: {
        code: 'UPSTREAM_GATEWAY_FAILURE',
        ...fallbackContext,
        troubleshooting: [
          'Check the MPESA_ENVIRONMENT and credentials match the active account',
          'Verify the initiator is authorized for B2Pochi transactions',
          'Regenerate the security credential if it has expired',
          'Check IP whitelisting and public callback accessibility',
          'Confirm the M-Pesa gateway is reachable from this environment',
        ],
      },
    };
  }

  return {
    statusCode: 500,
    message,
    error: 'INITIATION_FAILED',
    details: {
      code: 'SETTLEMENT_INITIATION_FAILED',
      ...fallbackContext,
    },
  };
}