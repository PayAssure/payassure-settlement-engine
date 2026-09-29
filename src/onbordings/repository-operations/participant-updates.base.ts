import { NotFoundException } from '@nestjs/common';
import { ParticipantStatus, Prisma } from '@prisma/client';
import { UpdateOnboardingDto } from '../dto/update-onboarding.dto';
import { OnbordingsParticipantReadsBase } from './participant-reads.base';

export abstract class OnbordingsParticipantUpdatesBase extends OnbordingsParticipantReadsBase {
  async updateParticipant(id: string, data: UpdateOnboardingDto) {
    const currentParticipant = await this.prisma.onboardingParticipant.findUnique({ where: { id } });
    if (!currentParticipant) throw new NotFoundException('Participant not found');
    const nextStatus = this.getStatusForProfile({
      participantType: currentParticipant.participantType,
      businessName: currentParticipant.businessName,
      registrationNumber: currentParticipant.registrationNumber ?? undefined,
      kraPin: currentParticipant.kraPin ?? undefined,
      businessType: currentParticipant.businessType ?? undefined,
      industry: currentParticipant.industry ?? undefined,
      physicalAddress: currentParticipant.physicalAddress ?? undefined,
      contactName: currentParticipant.contactName ?? undefined,
      email: currentParticipant.email ?? undefined,
      phoneNumber: currentParticipant.phoneNumber ?? undefined,
      settlementMethod: currentParticipant.settlementMethod ?? undefined,
      settlementAccount: currentParticipant.settlementAccount ?? undefined,
      posSystem: currentParticipant.posSystem ?? undefined,
      settlementPreference: currentParticipant.settlementPreference ?? undefined,
      ...data,
    });
    const participant = await this.prisma.onboardingParticipant.update({
      where: { id },
      data: {
        ...data,
        payment: (data as any).payment ? ((data as any).payment as Prisma.InputJsonValue) : undefined,
        status: nextStatus,
      },
      include: { integrations: { orderBy: { createdAt: 'desc' }, take: 1 } },
    });
    await this.prisma.integration.updateMany({
      where: { participantId: id },
      data: { isActive: nextStatus === ParticipantStatus.DOCUMENTS_SUBMITTED },
    });
    return this.findParticipantById(participant.id);
  }

  async updateWebhook(id: string, webhookUrl: string) {
    const participant = await this.prisma.onboardingParticipant.findUnique({ where: { id } });
    if (!participant) throw new NotFoundException('Participant not found');
    return this.prisma.onboardingParticipant.update({
      where: { id },
      data: { webhookUrl },
      include: { integrations: { orderBy: { createdAt: 'desc' }, take: 1 } },
    });
  }

  async updatePayment(id: string, payment: any) {
    const participant = await this.prisma.onboardingParticipant.findUnique({ where: { id } });
    if (!participant) throw new NotFoundException('Participant not found');
    return this.prisma.onboardingParticipant.update({
      where: { id },
      data: { payment: payment as Prisma.InputJsonValue },
      include: { integrations: { orderBy: { createdAt: 'desc' }, take: 1 } },
    });
  }
}
