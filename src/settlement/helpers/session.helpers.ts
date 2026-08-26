import { UnauthorizedException } from '@nestjs/common';
import { Logger } from '@nestjs/common';
import { SettlementRepository } from '../settlement.repository';

export async function validateAndGetSession(token: string, repository: SettlementRepository, logger: Logger) {
  const session = await repository.findSettlementSessionByToken(token);

  if (!session) {
    logger.warn(`Settlement token validation failed: token=${token} not found`);
    throw new UnauthorizedException({
      statusCode: 401,
      message: 'Invalid or expired one-time token',
      error: 'INVALID_TOKEN',
    });
  }

  if (session.expiresAt < new Date()) {
    logger.warn(`Settlement token validation failed: token=${token} expired at=${session.expiresAt.toISOString()}`);
    throw new UnauthorizedException({
      statusCode: 401,
      message: 'Token has expired',
      error: 'TOKEN_EXPIRED',
    });
  }

  // check session status (allow reusable short-lived sessions)
  if ((session as any).status && (session as any).status !== 'ACTIVE') {
    logger.warn(`Settlement token validation failed: token=${token} status=${(session as any).status}`);
    throw new UnauthorizedException({
      statusCode: 401,
      message: 'Session is not active',
      error: 'SESSION_INACTIVE',
    });
  }

  // Update last used timestamp to support sliding expiration and auditing
  try {
    await repository.touchSession(session.id);
  } catch (err) {
    logger.warn(`Failed to update session lastUsedAt for sessionId=${session.id}: ${(err as Error).message}`);
  }

  return session;
}
