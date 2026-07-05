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

  if (session.isUsed) {
    logger.warn(`Settlement token validation failed: token=${token} already used`);
    throw new UnauthorizedException({
      statusCode: 401,
      message: 'Token has already been used',
      error: 'TOKEN_ALREADY_USED',
    });
  }

  logger.log(`Settlement token validated successfully: sessionId=${session.id}`);
  return session;
}
