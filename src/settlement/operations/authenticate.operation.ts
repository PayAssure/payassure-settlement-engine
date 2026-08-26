import { ForbiddenException, NotFoundException, UnauthorizedException } from '@nestjs/common';
import { ParticipantStatus } from '@prisma/client';
import { AuthenticateDto } from '../dto/authenticate.dto';
import { hashCredential } from '../helpers/reference.helpers';

export async function authenticateOperation(
  prisma: any,
  repository: any,
  data: AuthenticateDto,
  user: any,
  logger: any,
  tokenExpiry: number,
) {
  const integration = await prisma.integration.findFirst({
    where: { apiKey: data.apiKey, isActive: true },
    include: { participant: true },
  });

  if (!integration) {
    throw new NotFoundException({ statusCode: 404, message: 'Business not found with provided API key', error: 'BUSINESS_NOT_FOUND' });
  }

  if (user && integration.participant && integration.participant.email) {
    const tokenEmail = (user && user.email) || '';
    if (tokenEmail !== integration.participant.email) {
      throw new UnauthorizedException({ statusCode: 401, message: 'Authenticated token does not belong to the owner of the provided API credentials', error: 'INVALID_TOKEN_FOR_API_KEYS' });
    }
  }

  const apiSecretHash = hashCredential(data.apiSecret);
  if (apiSecretHash !== integration.apiSecretHash) {
    throw new UnauthorizedException({ statusCode: 401, message: 'Invalid API credentials', error: 'INVALID_CREDENTIALS' });
  }

  if (integration.participant.status !== ParticipantStatus.ACTIVE) {
    throw new ForbiddenException({ statusCode: 403, message: 'Business account is not active', error: 'BUSINESS_NOT_ACTIVE' });
  }


  const token = `session_${Date.now()}_${require('crypto').randomBytes(16).toString('hex')}`;
  const expiresAt = new Date(Date.now() + tokenExpiry * 1000);

  await repository.createSettlementSession(integration.participantId, integration.id, token, expiresAt);

  return {
    success: true,
    token,
    expiresIn: tokenExpiry,
    tokenType: 'Bearer',
    business: {
      id: integration.participantId,
      businessName: integration.participant.businessName,
      participantType: integration.participant.participantType,
      status: integration.participant.status,
    },
  };
}
