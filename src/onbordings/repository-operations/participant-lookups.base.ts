import { NotFoundException } from '@nestjs/common';
import { OnbordingsCredentialGenerationBase } from './credential-generation.base';

export abstract class OnbordingsParticipantLookupsBase extends OnbordingsCredentialGenerationBase {
  async findUserByEmail(email: string) {
    return this.prisma.user.findUnique({ where: { email } });
  }

  async findParticipantByEmail(email: string) {
    if (!email) return null;
    const exactMatch = await this.prisma.onboardingParticipant.findFirst({
      where: { email },
      include: { integrations: { orderBy: { createdAt: 'desc' }, take: 1 } },
    });
    if (exactMatch) return exactMatch;
    return this.prisma.onboardingParticipant.findFirst({
      where: { email: { equals: email, mode: 'insensitive' } },
      include: { integrations: { orderBy: { createdAt: 'desc' }, take: 1 } },
    });
  }

  async findParticipantByUsername(username: string) {
    if (!username) return null;
    const participant = await this.prisma.onboardingParticipant.findFirst({
      where: { user: { username } },
      include: { integrations: { orderBy: { createdAt: 'desc' }, take: 1 } },
    });
    this.logger.log(
      participant
        ? `[PAYMENT_ACTIVATION_LOOKUP] Username match found: participantId=${participant.id}, email=${participant.email ?? 'null'}, status=${participant.status}, integrations=${participant.integrations?.length ?? 0}`
        : `[PAYMENT_ACTIVATION_LOOKUP] No onboarding participant matched username=${username}`,
    );
    return participant;
  }
}
