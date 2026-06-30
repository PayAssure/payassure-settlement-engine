import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { CreateIntegrationDto } from './dto/create-integration.dto';
import { CreateOnboardingDto } from './dto/create-onboarding.dto';
import { OnboardingResponseDto } from './dto/onboarding-response.dto';
import { UpdateOnboardingDto } from './dto/update-onboarding.dto';
import { OnbordingsRepository } from './onbordings.repository';

@Injectable()
export class OnbordingsService {
  constructor(private readonly repository: OnbordingsRepository) {}

  async createParticipant(data: CreateOnboardingDto): Promise<OnboardingResponseDto> {
    const user = data.email ? await this.repository.findUserByEmail(data.email) : null;
    const existingParticipant = data.email ? await this.repository.findParticipantByEmail(data.email) : null;
    const completionMessage = user
      ? undefined
      : 'Onboarding created. Please register an account to complete your profile.';
    const draftReasonMessage = this.isProfileIncomplete(data)
      ? 'Your onboarding request is currently in draft because the profile is incomplete. Please complete the required details to move it forward.'
      : undefined;

    if (existingParticipant) {
      if (existingParticipant.participantType === data.participantType) {
        const duplicateMessage ='This onboarding request was not created because an onboarding record for the same participant type already exists for this user.';

        return this.toResponse(existingParticipant, undefined, duplicateMessage);
      }

      if (this.shouldReuseParticipant(existingParticipant, data)) {
        return this.toResponse(existingParticipant, undefined, completionMessage);
      }
    }

    const created = await this.repository.createParticipantWithoutIntegration(data);
    return this.toResponse(created, undefined, draftReasonMessage ?? completionMessage);
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

  async generateApiKeys(user: any): Promise<OnboardingResponseDto> {
    const participant = await this.repository.findParticipantByEmail(user.email);
    if (!participant) {
      throw new NotFoundException('Onboarding participant not found for the authenticated user');
    }

    const existingIntegration = participant.integrations?.[0];
    if (existingIntegration) {
      if (existingIntegration.apiKey && existingIntegration.apiSecret) {
        const credentials = {
          merchantId: existingIntegration.merchantId,
          apiKey: existingIntegration.apiKey,
          apiSecret: existingIntegration.apiSecret,
        };

        return this.toResponse(
          participant,
          credentials,
          'API keys were not generated because they already exist. Use the existing credentials.',
        );
      }

      const regenerated = await this.repository.regenerateIntegrationCredentials(existingIntegration.id);
      const participantWithIntegration = await this.repository.findParticipantById(participant.id);
      return this.toResponse(
        participantWithIntegration,
        regenerated,
        'API keys were generated and persisted because previous credentials were missing.',
      );
    }

    const generated = await this.repository.createIntegrationForParticipant(participant.id, {});
    const participantWithIntegration = await this.repository.findParticipantById(participant.id);
    return this.toResponse(
      participantWithIntegration,
      generated,
      'These are the API keys generated for the first time.',
    );
  }

  async updateWebhook(id: string, webhookUrl: string): Promise<OnboardingResponseDto> {
    try {
      const participant = await this.repository.updateWebhook(id, webhookUrl);
      return this.toResponse(participant);
    } catch {
      throw new NotFoundException('Participant not found');
    }
  }

  private isProfileIncomplete(data: CreateOnboardingDto): boolean {
    const requiredFields = [
      data.participantType,
      data.businessName,
      data.contactName,
      data.email,
      data.phoneNumber,
      data.settlementMethod,
      data.settlementAccount,
    ];

    return requiredFields.some((value) => !value || (typeof value === 'string' && value.trim().length === 0));
  }

  private shouldReuseParticipant(existingParticipant: any, data: CreateOnboardingDto): boolean {
    if (!existingParticipant) {
      return false;
    }

    if (existingParticipant.participantType !== data.participantType) {
      return false;
    }

    const comparableFields = [
      'businessName',
      'registrationNumber',
      'kraPin',
      'businessType',
      'industry',
      'physicalAddress',
      'contactName',
      'phoneNumber',
      'settlementMethod',
      'settlementAccount',
      'posSystem',
      'settlementPreference',
    ] as const;

    return comparableFields.every((field) => (existingParticipant[field] ?? null) === (data[field] ?? null));
  }

  private toResponse(
    participant: any,
    credentials?: { merchantId: string; apiKey: string; apiSecret: string },
    message?: string,
  ): OnboardingResponseDto {
    const activeIntegration = participant.integrations?.[0];

    return {
      message,
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
            apiKey: credentials?.apiKey ?? activeIntegration.apiKey ?? '',
            apiSecret: credentials?.apiSecret ?? activeIntegration.apiSecret ?? '',
            environment: activeIntegration.environment,
            createdAt: activeIntegration.createdAt,
          }
        : null,
      createdAt: participant.createdAt,
      updatedAt: participant.updatedAt,
    };
  }
}
