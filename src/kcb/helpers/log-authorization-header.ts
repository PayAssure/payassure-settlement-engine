import { createHash } from 'crypto';
import type { Logger } from '@nestjs/common';

export function logAuthorizationHeader(logger: Logger, message: string, authorizationHeader: string): void {
  const [scheme, token] = authorizationHeader.split(' ');
  const tokenFingerprint = createHash('sha256').update(token).digest('hex').slice(0, 12);
  const maskedToken = token.length > 12
    ? `${token.slice(0, 6)}...${token.slice(-6)}`
    : '[short-token]';

  logger.log(`${message}: scheme=${scheme}, token=${maskedToken}, fingerprint=${tokenFingerprint}`);
}
