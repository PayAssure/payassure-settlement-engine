import { Prisma } from '@prisma/client';
import { CreateOnboardingDto } from '../dto/create-onboarding.dto';
import { OnbordingsIntegrationLookupsBase } from './integration-lookups.base';

export abstract class OnbordingsParticipantReadsBase extends OnbordingsIntegrationLookupsBase {
  async createParticipantWithoutIntegration(data: CreateOnboardingDto & { userId?: string }) {
    return this.prisma.onboardingParticipant.create({
      data: {
        userId: data.userId,
        participantType: data.participantType,
        businessName: data.businessName,
        registrationNumber: data.registrationNumber,
        kraPin: data.kraPin,
        businessType: data.businessType,
        industry: data.industry,
        physicalAddress: data.physicalAddress,
        contactName: data.contactName,
        email: data.email,
        phoneNumber: data.phoneNumber,
        settlementMethod: data.settlementMethod,
        settlementAccount: data.settlementAccount,
        posSystem: data.posSystem,
        settlementPreference: data.settlementPreference,
        payment: data.payment ? (data.payment as unknown as Prisma.InputJsonValue) : undefined,
        status: this.getStatusForProfile(data),
      },
    });
  }

  async findAllParticipants() {
    return this.prisma.onboardingParticipant.findMany({
      include: { integrations: { orderBy: { createdAt: 'desc' }, take: 1 } },
    });
  }

  async findParticipantById(id: string) {
    return this.prisma.onboardingParticipant.findUnique({
      where: { id },
      include: { integrations: { orderBy: { createdAt: 'desc' }, take: 1 } },
    });
  }
}
