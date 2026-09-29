import { NotFoundException } from '@nestjs/common';
import { PaymentMethodDto } from '../dto/payment-method.dto';
import { OnboardingResponseDto } from '../dto/onboarding-response.dto';
import { OnbordingsApiKeysBase } from './api-keys.base';

export abstract class OnbordingsPaymentDestinationsBase extends OnbordingsApiKeysBase {
  async updateWebhook(id: string, webhookUrl: string): Promise<OnboardingResponseDto> {
    try {
      const participant = await this.repository.updateWebhook(id, webhookUrl);
      return this.toResponse(participant);
    } catch {
      throw new NotFoundException('Participant not found');
    }
  }

  async updatePayment(id: string, payment: PaymentMethodDto): Promise<OnboardingResponseDto> {
    this.validatePaymentMethod(payment);
    const preparedPayment = this.preparePaymentForStorage(payment);
    const participant = await this.repository.updatePayment(id, preparedPayment.payment);
    return this.toResponse(this.attachActivationSecret(participant, preparedPayment.paymentActivationSecret));
  }

  async updatePaymentForUser(user: any, payment: PaymentMethodDto): Promise<OnboardingResponseDto> {
    this.logger.log(`updatePaymentForUser invoked for user=${user?.email ?? 'unknown'}`);
    this.validatePaymentMethod(payment);
    const preparedPayment = this.preparePaymentForStorage(payment);
    const participant = await this.repository.findParticipantByEmail(user?.email ?? '');
    if (!participant) {
      this.logger.warn(`Authenticated user not found as onboarding participant: email=${user?.email ?? 'undefined'}`);
      throw new NotFoundException('Onboarding participant not found for the authenticated user');
    }
    this.logger.log(`Authenticated participant found: id=${participant.id}, email=${participant.email}`);
    const updatedParticipant = await this.repository.updatePayment(participant.id, preparedPayment.payment);
    this.logger.log(`Updated payment destination for participant id=${participant.id}`);
    return this.toResponse(this.attachActivationSecret(updatedParticipant, preparedPayment.paymentActivationSecret));
  }
}
