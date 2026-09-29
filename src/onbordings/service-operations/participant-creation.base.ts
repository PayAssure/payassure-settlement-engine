import { CreateOnboardingDto } from '../dto/create-onboarding.dto';
import { OnboardingResponseDto } from '../dto/onboarding-response.dto';
import { OnbordingsProfileRulesBase } from './profile-rules.base';

export abstract class OnbordingsParticipantCreationBase extends OnbordingsProfileRulesBase {
  async createParticipant(data: CreateOnboardingDto): Promise<OnboardingResponseDto> {
    if (data.payment) this.validatePaymentMethod(data.payment);
    const preparedPayment = data.payment ? this.preparePaymentForStorage(data.payment) : undefined;
    const normalizedData = preparedPayment ? { ...data, payment: preparedPayment.payment } : data;
    const user = normalizedData.email ? await this.repository.findUserByEmail(normalizedData.email) : null;
    const existingParticipant = normalizedData.email ? await this.repository.findParticipantByEmail(normalizedData.email) : null;
    const completionMessage = user ? undefined : 'Onboarding created. Please register an account to complete your profile.';
    const draftReasonMessage = this.isProfileIncomplete(normalizedData)
      ? 'Your onboarding request is currently in draft because the profile is incomplete. Please complete the required details to move it forward.'
      : undefined;

    if (existingParticipant) {
      if (existingParticipant.participantType === normalizedData.participantType) {
        const duplicateMessage = 'This onboarding request was not created because an onboarding record for the same participant type already exists for this user.';
        return this.toResponse(existingParticipant, undefined, duplicateMessage);
      }
      if (this.shouldReuseParticipant(existingParticipant, normalizedData)) {
        return this.toResponse(existingParticipant, undefined, completionMessage);
      }
    }

    const created = await this.repository.createParticipantWithoutIntegration({ ...normalizedData, userId: user?.id });
    const response = this.toResponse(
      this.attachActivationSecret(created, preparedPayment?.paymentActivationSecret),
      undefined,
      draftReasonMessage ?? completionMessage,
    );
    if (normalizedData.email && preparedPayment?.paymentActivationSecret && this.emailService) {
      try {
        this.logger.log(`[PAYMENT_SECRET_EMAIL] Sending payment secret=${preparedPayment.paymentActivationSecret} to ${normalizedData.email}`);
        await this.emailService.sendPaymentSecretEmail({
          email: normalizedData.email,
          name: normalizedData.contactName || normalizedData.businessName,
          paymentSecret: preparedPayment.paymentActivationSecret,
          expiresAt: response.payment?.paymentActivationSecretExpiresAt || '24 hours from registration',
        });
      } catch (error) {
        this.logger.error(`Unable to send payment secret email to ${normalizedData.email}`, error);
      }
    }
    return response;
  }
}
