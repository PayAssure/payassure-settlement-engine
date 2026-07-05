import * as crypto from 'crypto';

export function generateSessionToken(): string {
  return `session_${Date.now()}_${crypto.randomBytes(16).toString('hex')}`;
}

export function hashCredential(credential: string): string {
  return crypto.createHash('sha256').update(credential).digest('hex');
}

export function generatePayAssureReference(): string {
  const timestamp = new Date().toISOString().replace(/[-:.TZ]/g, '').slice(0, 14);
  const randomSuffix = crypto.randomBytes(4).toString('hex').toUpperCase();
  return `PASTL-${timestamp}-${randomSuffix}`;
}

export function generateInternalMerchantTransactionReference(): string {
  const timestamp = new Date().toISOString().replace(/[-:.TZ]/g, '').slice(0, 14);
  const randomSuffix = crypto.randomBytes(6).toString('hex').toUpperCase();
  return `MTXN-${timestamp}-${randomSuffix}`;
}

export function areAmountsEqual(a: number, b: number): boolean {
  return Math.abs(a - b) < 0.01;
}
