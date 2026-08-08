import * as crypto from 'crypto';

export function getSettlementConfirmationApiToken(): string | undefined {
  return process.env.PAYMENT_GATEWAY_API_TOKEN || process.env.SETTLEMENT_API_TOKEN || process.env.INTERNAL_GATEWAY_TOKEN;
}

export function getSettlementConfirmationSignatureSecret(): string | undefined {
  return process.env.PAYMENT_GATEWAY_SIGNATURE_SECRET || process.env.SETTLEMENT_SIGNATURE_SECRET || process.env.PAYASSURE_INTERNAL_SECRET;
}

export function createSettlementConfirmationSignature(secret: string): string {
  return crypto.createHmac('sha256', secret).update('').digest('hex');
}
