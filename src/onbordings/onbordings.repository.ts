import { Injectable, InternalServerErrorException, NotFoundException, OnModuleDestroy } from '@nestjs/common';
import { createHash, randomBytes } from 'crypto';
import { ParticipantStatus, PrismaClient } from '@prisma/client';
import { CreateIntegrationDto } from './dto/create-integration.dto';
import { CreateOnboardingDto } from './dto/create-onboarding.dto';
import { UpdateOnboardingDto } from './dto/update-onboarding.dto';

@Injectable()
export class OnbordingsRepository implements OnModuleDestroy {
  private prisma = new PrismaClient();

  async findUserByEmail(email: string) {
    return this.prisma.user.findUnique({ where: { email } });
  }

  async findParticipantByEmail(email: string) {
    return this.prisma.onboardingParticipant.findFirst({
      where: { email },
      include: { integrations: { orderBy: { createdAt: 'desc' }, take: 1 } },
    });
  }

  async createParticipantWithoutIntegration(data: CreateOnboardingDto) {
    return this.prisma.onboardingParticipant.create({
      data: {
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

  async updateParticipant(id: string, data: UpdateOnboardingDto) {
    const currentParticipant = await this.prisma.onboardingParticipant.findUnique({ where: { id } });
    if (!currentParticipant) {
      throw new NotFoundException('Participant not found');
    }

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

    return this.prisma.onboardingParticipant.update({
      where: { id },
      data: {
        ...data,
        status: nextStatus,
      },
      include: { integrations: { orderBy: { createdAt: 'desc' }, take: 1 } },
    });
  }

  async updateWebhook(id: string, webhookUrl: string) {
    const participant = await this.prisma.onboardingParticipant.findUnique({ where: { id } });
    if (!participant) {
      throw new NotFoundException('Participant not found');
    }

    return this.prisma.onboardingParticipant.update({
      where: { id },
      data: { webhookUrl },
      include: { integrations: { orderBy: { createdAt: 'desc' }, take: 1 } },
    });
  }

  async deleteParticipant(id: string) {
    return this.prisma.onboardingParticipant.delete({ where: { id } });
  }

  async createIntegrationForParticipant(id: string, data: CreateIntegrationDto) {
    const participant = await this.prisma.onboardingParticipant.findUnique({ where: { id } });
    if (!participant) {
      throw new NotFoundException('Participant not found');
    }

    const merchantId = this.generateMerchantId();
    const apiKey = this.generateCredential('pk_live');
    const apiSecret = this.generateCredential('sk_live');

    this.validateCredentials(merchantId, apiKey, apiSecret);

    const integration = await this.prisma.integration.create({
      data: {
        participantId: id,
        merchantId,
        apiKey,
        apiSecret,
        apiKeyHash: this.hashSecret(apiKey),
        apiSecretHash: this.hashSecret(apiSecret),
        environment: data.environment ?? 'production',
        webhookUrl: data.webhookUrl,
      },
    });

    return { ...integration, apiKey, apiSecret };
  }

  async regenerateIntegrationCredentials(integrationId: string) {
    const apiKey = this.generateCredential('pk_live');
    const apiSecret = this.generateCredential('sk_live');

    this.validateCredentials('dummy-merchant', apiKey, apiSecret);

    const integration = await this.prisma.integration.update({
      where: { id: integrationId },
      data: {
        apiKey,
        apiSecret,
        apiKeyHash: this.hashSecret(apiKey),
        apiSecretHash: this.hashSecret(apiSecret),
      },
    });

    return { ...integration, apiKey, apiSecret };
  }

  private validateCredentials(merchantId: string, apiKey: string, apiSecret: string) {
    if (!merchantId || !apiKey || !apiSecret) {
      throw new InternalServerErrorException(
        'Invalid API credential data generated. No partial credentials were persisted.',
      );
    }
  }

  private getStatusForProfile(data: Partial<CreateOnboardingDto>): ParticipantStatus {
    const requiredFields = [
      'participantType',
      'businessName',
      'contactName',
      'email',
      'phoneNumber',
      'settlementMethod',
      'settlementAccount',
    ] as const;

    const isComplete = requiredFields.every((field) => {
      const value = data[field];
      return typeof value === 'string' ? value.trim().length > 0 : Boolean(value);
    });

    return isComplete ? ParticipantStatus.DOCUMENTS_SUBMITTED : ParticipantStatus.DRAFT;
  }

  private generateMerchantId(): string {
    return `pay_${randomBytes(8).toString('hex')}`;
  }

  private generateCredential(prefix: string): string {
    return `${prefix}_${randomBytes(16).toString('hex')}`;
  }

  private hashSecret(secret: string): string {
    return createHash('sha256').update(secret).digest('hex');
  }

  async onModuleDestroy() {
    await this.prisma.$disconnect();
  }
}
