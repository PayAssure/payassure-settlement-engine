import { NotFoundException } from '@nestjs/common';
import { OnboardingResponseDto } from '../dto/onboarding-response.dto';
import { OnbordingsParticipantUpdatesBase } from './participant-updates.base';

export abstract class OnbordingsApiKeysBase extends OnbordingsParticipantUpdatesBase {
  async generateApiKeys(user: any): Promise<OnboardingResponseDto> {
    const participant = await this.repository.findParticipantByEmail(user.email);
    if (!participant) throw new NotFoundException('Onboarding participant not found for the authenticated user');
    const existingIntegration = participant.integrations?.[0];
    if (existingIntegration) {
      if (existingIntegration.apiKey && existingIntegration.apiSecret) {
        const credentials = { merchantId: existingIntegration.merchantId, apiKey: existingIntegration.apiKey, apiSecret: existingIntegration.apiSecret };
        return this.toResponse(participant, credentials, 'API keys were not generated because they already exist. Use the existing credentials.');
      }
      const regenerated = await this.repository.regenerateIntegrationCredentials(existingIntegration.id);
      const participantWithIntegration = await this.repository.findParticipantById(participant.id);
      return this.toResponse(participantWithIntegration, regenerated, 'API keys were generated and persisted because previous credentials were missing.');
    }
    const generated = await this.repository.createIntegrationForParticipant(participant.id, {});
    const participantWithIntegration = await this.repository.findParticipantById(participant.id);
    return this.toResponse(participantWithIntegration, generated, 'These are the API keys generated for the first time.');
  }

  async viewApiKeys(user: any): Promise<OnboardingResponseDto> {
    const participant = await this.repository.findParticipantByEmail(user.email);
    if (!participant) throw new NotFoundException('Onboarding participant not found for the authenticated user');
    const integration = participant.integrations?.[0];
    if (!integration || !integration.apiKey || !integration.apiSecret) {
      throw new NotFoundException('API keys not found for the authenticated user');
    }
    return this.toResponse(participant, { merchantId: integration.merchantId, apiKey: integration.apiKey, apiSecret: integration.apiSecret });
  }
}
