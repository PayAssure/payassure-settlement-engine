import { InternalServerErrorException } from '@nestjs/common';
import { ParticipantStatus } from '@prisma/client';
import { CreateOnboardingDto } from '../dto/create-onboarding.dto';
import { OnbordingsRepositoryContextBase } from './repository-context.base';

export abstract class OnbordingsProfileStatusBase extends OnbordingsRepositoryContextBase {
  async activateParticipantIfReady(id: string) {
    const participant = await this.prisma.onboardingParticipant.findUnique({
      where: { id },
      include: { integrations: { orderBy: { createdAt: 'desc' }, take: 1 } },
    });
    if (!participant || participant.status === ParticipantStatus.REJECTED) return participant;

    const payment = participant.payment as { status?: string; isVerified?: boolean } | null;
    const integration = participant.integrations?.[0];
    const profileComplete = this.getStatusForProfile(
      participant as unknown as Partial<CreateOnboardingDto>,
    ) === ParticipantStatus.DOCUMENTS_SUBMITTED;
    const paymentVerified = payment?.status === 'VERIFIED' || payment?.isVerified === true;
    const credentialsGenerated = Boolean(integration?.apiKey && integration?.apiSecret);

    if (!profileComplete || !paymentVerified || !credentialsGenerated) return participant;

    if (participant.status !== ParticipantStatus.ACTIVE && participant.status !== ParticipantStatus.LIVE) {
      await this.prisma.onboardingParticipant.update({
        where: { id },
        data: { status: ParticipantStatus.ACTIVE },
      });
    }
    if (integration && !integration.isActive) {
      await this.prisma.integration.update({
        where: { id: integration.id },
        data: { isActive: true },
      });
    }

    return this.prisma.onboardingParticipant.findUnique({
      where: { id },
      include: { integrations: { orderBy: { createdAt: 'desc' }, take: 1 } },
    });
  }

  protected validateCredentials(merchantId: string, apiKey: string, apiSecret: string) {
    if (!merchantId || !apiKey || !apiSecret) {
      throw new InternalServerErrorException('Invalid API credential data generated. No partial credentials were persisted.');
    }
  }

  protected getStatusForProfile(data: Partial<CreateOnboardingDto>): ParticipantStatus {
    const requiredFields = ['participantType', 'businessName', 'contactName', 'email', 'phoneNumber', 'settlementMethod', 'settlementAccount'] as const;
    const isComplete = requiredFields.every((field) => {
      const value = data[field];
      return typeof value === 'string' ? value.trim().length > 0 : Boolean(value);
    });
    return isComplete ? ParticipantStatus.DOCUMENTS_SUBMITTED : ParticipantStatus.DRAFT;
  }
}
