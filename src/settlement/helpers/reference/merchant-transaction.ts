import * as crypto from 'crypto';

export function generateInternalMerchantTransactionReference(): string {
  const timestamp = new Date().toISOString().replace(/[-:.TZ]/g, '').slice(0, 14);
  const randomSuffix = crypto.randomBytes(6).toString('hex').toUpperCase();
  return `MTXN-${timestamp}-${randomSuffix}`;
}
