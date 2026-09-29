import { OnbordingsPaymentInputBase } from './payment-input.base';

export abstract class OnbordingsResponseDetailsBase extends OnbordingsPaymentInputBase {
  protected attachActivationSecret(participant: any, paymentActivationSecret?: string) {
    if (!participant || !paymentActivationSecret) return participant;
    const existingPayment = participant.payment as any;
    if (!existingPayment) return participant;
    return {
      ...participant,
      payment: { ...existingPayment, paymentActivationSecret },
    };
  }

  protected toSafePaymentResponse(payment: any) {
    if (!payment) return null;
    const {
      paymentActivationSecretHash,
      paymentActivationSecretExpiresAt,
      verificationAttempts,
      verificationMethod,
      verifiedAt,
      ...safePayment
    } = payment;
    return safePayment;
  }
}
