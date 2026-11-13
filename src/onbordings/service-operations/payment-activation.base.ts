import { ForbiddenException, InternalServerErrorException, NotFoundException, UnauthorizedException } from '@nestjs/common';
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

  async resendPaymentActivationSecret(user: any): Promise<{ message: string }> {
    const email = user?.email ?? '';
    if (!email) throw new UnauthorizedException('Authenticated user email is required');
    if (!this.emailService) throw new InternalServerErrorException('Payment activation email service is not configured');

    const participant = await this.repository.findParticipantByEmail(email);
    if (!participant) throw new NotFoundException('Onboarding participant not found for the authenticated user');

    const payment = participant.payment as Record<string, unknown> | null;
    if (!payment) throw new ForbiddenException('Participant payment destination is not configured');
    if (payment.status !== 'PENDING_VERIFICATION') {
      throw new ForbiddenException('Participant payment destination is not pending verification');
    }

    const activationSecret = this.generatePaymentActivationSecret();
    const { paymentActivationSecret: _previousSecret, ...paymentWithoutRawSecret } = payment;
    await this.repository.updatePayment(participant.id, {
      ...paymentWithoutRawSecret,
      paymentActivationSecretHash: activationSecret.hash,
      paymentActivationSecretExpiresAt: activationSecret.expiresAt,
      verificationAttempts: 0,
    });

    try {
      await this.emailService.sendPaymentSecretEmail({
        email,
        name: participant.contactName || participant.businessName,
        paymentSecret: activationSecret.secret,
        expiresAt: activationSecret.expiresAt,
      }, 'resend');
    } catch (error) {
      this.logger.error(
        `Unable to send payment activation secret email to ${email}`,
        error instanceof Error ? error.stack : String(error),
      );
      throw new InternalServerErrorException('Unable to send payment activation secret email. Please retry.');
    }

    return { message: 'A new payment activation secret has been sent to your email address.' };
  }
}
