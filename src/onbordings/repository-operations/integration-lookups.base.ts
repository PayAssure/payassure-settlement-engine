import { NotFoundException } from '@nestjs/common';
import { OnbordingsParticipantLookupsBase } from './participant-lookups.base';

export abstract class OnbordingsIntegrationLookupsBase extends OnbordingsParticipantLookupsBase {
  async findIntegrationCredentialsByEmail(email: string, isActive?: boolean) {
    if (!email) {
      throw new NotFoundException('User email is required');
    }
    const participant = await this.prisma.onboardingParticipant.findFirst({
      where: { email: { equals: email, mode: 'insensitive' } },
      include: {
        integrations: {
          where: isActive === undefined ? undefined : { isActive },
          orderBy: { createdAt: 'desc' },
          take: 1,
        },
      },
    });
    const integration = participant?.integrations?.[0];
    if (!participant || !integration) {
      throw new NotFoundException('Integration credentials not found for the provided email and active status');
    }
    return {
      id: integration.id,
      participantId: participant.id,
      participantEmail: participant.email,
      merchantId: integration.merchantId,
      apiKey: integration.apiKey,
      apiSecret: integration.apiSecret,
      environment: integration.environment,
      isActive: integration.isActive,
      createdAt: integration.createdAt,
    };
  }
}
