import { NotFoundException, UnauthorizedException } from '@nestjs/common';
import { CreateIntegrationDto } from '../dto/create-integration.dto';
import { OnboardingResponseDto } from '../dto/onboarding-response.dto';
import { UpdateOnboardingDto } from '../dto/update-onboarding.dto';
import { OnbordingsIntegrationCredentialsBase } from './integration-credentials.base';

export abstract class OnbordingsParticipantUpdatesBase extends OnbordingsIntegrationCredentialsBase {
  async updateParticipantForAuthenticatedUser(user: any, data: UpdateOnboardingDto): Promise<OnboardingResponseDto> {
    const email = user?.email;
    if (!email) throw new UnauthorizedException('Authenticated user email is required');
    const participant = await this.repository.findParticipantByEmail(email);
    if (!participant) throw new NotFoundException('Onboarding participant not found for the authenticated user');
    return this.updateParticipant(participant.id, data);
  }

  async updateParticipant(id: string, data: UpdateOnboardingDto): Promise<OnboardingResponseDto> {
    if (data.payment) this.validatePaymentMethod(data.payment);
    const preparedPayment = data.payment ? this.preparePaymentForStorage(data.payment) : undefined;
    const normalizedData = preparedPayment ? { ...data, payment: preparedPayment.payment } : data;
    try {
      const participant = await this.repository.updateParticipant(id, normalizedData);
      return this.toResponse(this.attachActivationSecret(participant, preparedPayment?.paymentActivationSecret));
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
    if (!participant) throw new NotFoundException('Participant not found');
    return this.repository.createIntegrationForParticipant(id, data);
  }
}
