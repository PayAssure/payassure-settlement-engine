import { NotFoundException, UnauthorizedException } from '@nestjs/common';
import { OnboardingResponseDto } from '../dto/onboarding-response.dto';
import { OnbordingsPaymentDestinationsBase } from './payment-destinations.base';

export abstract class OnbordingsPaymentActivationBase extends OnbordingsPaymentDestinationsBase {
  async activatePayment(user: any, data: { paymentActivationSecret: string }): Promise<OnboardingResponseDto> {
    const email = user?.email ?? '';
    this.logger.log(`[PAYMENT_ACTIVATION_LOOKUP] Authenticated claims: email=${email || 'missing'}, role=${user?.role ?? 'missing'}`);
    if (!email) throw new UnauthorizedException('Authenticated user email is required');
    const participant = await this.repository.findParticipantByEmail(email);
    this.logger.log(
      participant
        ? `[PAYMENT_ACTIVATION_LOOKUP] Service received participant: id=${participant.id}, email=${participant.email ?? 'null'}, status=${participant.status}`
        : `[PAYMENT_ACTIVATION_LOOKUP] Service received no participant for email=${email}`,
    );
    if (!participant) {
      this.logger.warn('[PAYMENT_ACTIVATION_LOOKUP] Authenticated user not found for payment activation');
      throw new NotFoundException('Onboarding participant not found for the authenticated user');
    }
    const activatedParticipant = await this.repository.activatePayment(participant.id, data.paymentActivationSecret);
    return this.toResponse(activatedParticipant);
  }
}
