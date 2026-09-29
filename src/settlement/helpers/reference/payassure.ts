import * as crypto from 'crypto';

export function generatePayAssureReference(): string {
  const timestamp = new Date().toISOString().replace(/[-:.TZ]/g, '').slice(0, 14);
  const randomSuffix = crypto.randomBytes(4).toString('hex').toUpperCase();
  return `PASTL-${timestamp}-${randomSuffix}`;
}
