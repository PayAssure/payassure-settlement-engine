import * as crypto from 'crypto';

export function generateSessionToken(): string {
  return `session_${Date.now()}_${crypto.randomBytes(16).toString('hex')}`;
}

export function hashCredential(credential: string): string {
  return crypto.createHash('sha256').update(credential).digest('hex');
}
