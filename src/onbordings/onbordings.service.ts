import { Injectable, NotFoundException } from '@nestjs/common';
import { CreateIntegrationDto } from './dto/create-integration.dto';
import { CreateOnboardingDto } from './dto/create-onboarding.dto';
import { OnboardingResponseDto } from './dto/onboarding-response.dto';
import { UpdateOnboardingDto } from './dto/update-onboarding.dto';
import { OnbordingsRepository } from './onbordings.repository';

@Injectable()
export class OnbordingsService {
  constructor(private readonly repository: OnbordingsRepository) {}

  async createParticipant(data: CreateOnboardingDto): Promise<OnboardingResponseDto> {
    const created = await this.repository.createParticipantWithIntegration(data);

    return this.toResponse(created, created.credentials);
  }

  async findAllParticipants(): Promise<OnboardingResponseDto[]> {
    const participants = await this.repository.findAllParticipants();
    return participants.map((participant) => this.toResponse(participant));
  }

  async findParticipantById(id: string): Promise<OnboardingResponseDto> {
    const participant = await this.repository.findParticipantById(id);
    if (!participant) {
      throw new NotFoundException('Participant not found');
    }

    return this.toResponse(participant);
  }

  async updateParticipant(id: string, data: UpdateOnboardingDto): Promise<OnboardingResponseDto> {
    try {
      const participant = await this.repository.updateParticipant(id, data);
      return this.toResponse(participant);
    } catch {
      throw new NotFoundException('Participant not found');
    }
  }

  async deleteParticipant(id: string): Promise<void> {
    try {
      await this.repository.deleteParticipant(id);
    } catch {
      throw new NotFoundException('Participant not found');
    }
  }

  async createIntegration(id: string, data: CreateIntegrationDto) {
    const participant = await this.repository.findParticipantById(id);
    if (!participant) {
      throw new NotFoundException('Participant not found');
    }

    return this.repository.createIntegrationForParticipant(id, data);
  }

  async updateWebhook(id: string, webhookUrl: string): Promise<OnboardingResponseDto> {
    try {
      const participant = await this.repository.updateWebhook(id, webhookUrl);
      return this.toResponse(participant);
    } catch {
      throw new NotFoundException('Participant not found');
    }
  }

  private toResponse(participant: any, credentials?: { merchantId: string; apiKey: string; apiSecret: string }): OnboardingResponseDto {
    const activeIntegration = participant.integrations?.[0];

    return {
      id: participant.id,
      participantType: participant.participantType,
      businessName: participant.businessName,
      businessType: participant.businessType,
      contactName: participant.contactName,
      email: participant.email,
      status: participant.status,
      integration: activeIntegration
        ? {
            id: activeIntegration.id,
            merchantId: credentials?.merchantId ?? activeIntegration.merchantId,
            apiKey: credentials?.apiKey ?? '',
            apiSecret: credentials?.apiSecret ?? '',
            environment: activeIntegration.environment,
            createdAt: activeIntegration.createdAt,
          }
        : null,
      createdAt: participant.createdAt,
      updatedAt: participant.updatedAt,
    };
  }
}
