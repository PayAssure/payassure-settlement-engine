export function getGatewayAccountReference(): string {
  return process.env.GATEWAY_ACCOUNT_REFERENCE || process.env.MPESA_ACCOUNT_REFERENCE || 'payassure';
}