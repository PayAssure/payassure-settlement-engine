import { Injectable, NotFoundException, OnModuleDestroy } from '@nestjs/common';
import { createHash, randomBytes } from 'crypto';
import { PrismaClient } from '@prisma/client';
import { CreateIntegrationDto } from './dto/create-integration.dto';
import { CreateOnboardingDto } from './dto/create-onboarding.dto';
import { UpdateOnboardingDto } from './dto/update-onboarding.dto';

@Injectable()
export class OnbordingsRepository implements OnModuleDestroy {
  private prisma = new PrismaClient();

  async createParticipantWithIntegration(data: CreateOnboardingDto) {
    const merchantId = this.generateMerchantId();
    const apiKey = this.generateCredential('pk_live');
    const apiSecret = this.generateCredential('sk_live');

    return this.prisma.$transaction(async (tx) => {
      const participant = await tx.onboardingParticipant.create({
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
          status: 'DRAFT',
        },
      });

      const integration = await tx.integration.create({
        data: {
          participantId: participant.id,
          merchantId,
          apiKeyHash: this.hashSecret(apiKey),
          apiSecretHash: this.hashSecret(apiSecret),
          environment: 'production',
        },
      });

      return {
        ...participant,
        integrations: [integration],
        credentials: { merchantId, apiKey, apiSecret },
      };
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
    return this.prisma.onboardingParticipant.update({
      where: { id },
      data,
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

    const integration = await this.prisma.integration.create({
      data: {
        participantId: id,
        merchantId,
        apiKeyHash: this.hashSecret(apiKey),
        apiSecretHash: this.hashSecret(apiSecret),
        environment: data.environment ?? 'production',
        webhookUrl: data.webhookUrl,
      },
    });

    return { ...integration, apiKey, apiSecret };
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
