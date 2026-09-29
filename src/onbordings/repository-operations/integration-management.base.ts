import { NotFoundException } from '@nestjs/common';
import { ParticipantStatus } from '@prisma/client';
import { CreateIntegrationDto } from '../dto/create-integration.dto';
import { CreateOnboardingDto } from '../dto/create-onboarding.dto';
import { OnbordingsPaymentActivationBase } from './payment-activation.base';

export abstract class OnbordingsIntegrationManagementBase extends OnbordingsPaymentActivationBase {
  async createIntegrationForParticipant(id: string, data: CreateIntegrationDto) {
    const participant = await this.prisma.onboardingParticipant.findUnique({ where: { id } });
    if (!participant) throw new NotFoundException('Participant not found');
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
        isActive: this.getStatusForProfile(participant as unknown as Partial<CreateOnboardingDto>) === ParticipantStatus.DOCUMENTS_SUBMITTED,
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
}
