import { ParticipantStatus } from '@prisma/client';
import { AuthUserManagementBase } from './user-management.base';

export abstract class AuthOnboardingAccessBase extends AuthUserManagementBase {
  async findOnboardedByEmail(email: string) {
    return this.prisma.onboardingParticipant.findFirst({
      where: { email },
    });
  }

  async linkParticipantToUser(email: string, userId: string) {
    return this.prisma.onboardingParticipant.updateMany({
      where: { email: { equals: email, mode: 'insensitive' }, userId: null },
      data: { userId },
    });
  }

  async activateBusinessIfComplete(email: string) {
    const participant = await this.prisma.onboardingParticipant.findFirst({
      where: { email },
      include: { integrations: { orderBy: { createdAt: 'desc' }, take: 1 } },
    });

    if (!participant) {
      return;
    }

    const requiredFields = [
      participant.participantType,
      participant.businessName,
      participant.contactName,
      participant.email,
      participant.phoneNumber,
      participant.settlementMethod,
      participant.settlementAccount,
    ];

    const profileComplete = requiredFields.every((value) =>
      typeof value === 'string' ? value.trim().length > 0 : Boolean(value),
    );

    if (!profileComplete) {
      return;
    }

    const payment = participant.payment as any;
    const paymentVerified = payment?.status === 'VERIFIED' || payment?.isVerified === true;
    if (!paymentVerified) {
      return;
    }

    const existingIntegration = participant.integrations?.[0];
    if (!existingIntegration || participant.status === ParticipantStatus.LIVE || participant.status === ParticipantStatus.ACTIVE) {
      return;
    }

    await this.prisma.onboardingParticipant.update({
      where: { id: participant.id },
      data: { status: ParticipantStatus.LIVE },
    });
  }
}
