import { ForbiddenException } from '@nestjs/common';
import { createHash, randomBytes } from 'crypto';
import { PaymentMethodDto } from '../dto/payment-method.dto';
import { OnbordingsServiceContextBase } from './service-context.base';

export abstract class OnbordingsPaymentInputBase extends OnbordingsServiceContextBase {
  protected validatePaymentMethod(payment: PaymentMethodDto): void {
    if (!payment.type || !['MPESA', 'BANK'].includes(payment.type)) throw new ForbiddenException('Payment type must be MPESA or BANK');
    if (!payment.accountName) throw new ForbiddenException('Payment accountName is required');
    if (payment.isVerified !== undefined) throw new ForbiddenException('isVerified is managed by the backend and must not be provided in the request payload');
    if (payment.type === 'MPESA') {
      if (payment.bankCode || payment.accountNumber || payment.shortcode) {
        throw new ForbiddenException('MPESA payouts do not accept bankCode, accountNumber or shortcode in the request payload');
      }
      const mpesaPhoneNumber = payment.phoneNumber ?? payment.payerPhoneNumber;
      if (!mpesaPhoneNumber) throw new ForbiddenException('phoneNumber is required for MPESA payout destinations');
    }
    if (payment.type === 'BANK') {
      if (payment.phoneNumber || payment.payerPhoneNumber) throw new ForbiddenException('BANK payouts do not accept phoneNumber in the request payload');
      if (!payment.bankCode || !payment.accountNumber) throw new ForbiddenException('bankCode and accountNumber are required for BANK payout destinations');
      if (payment.shortcode !== undefined && !/^[0-9]+$/.test(payment.shortcode)) {
        throw new ForbiddenException('shortcode must contain only digits');
      }
    }
  }

  protected preparePaymentForStorage(payment: PaymentMethodDto): { payment: PaymentMethodDto; paymentActivationSecret?: string } {
    const activationSecret = `paysec_${randomBytes(16).toString('hex')}`;
    const activationSecretHash = createHash('sha256').update(activationSecret).digest('hex');
    const normalizedPayment: PaymentMethodDto = {
      ...payment,
      phoneNumber: payment.phoneNumber ?? payment.payerPhoneNumber,
      payerPhoneNumber: undefined,
      status: 'PENDING_VERIFICATION',
      isVerified: false,
      paymentActivationSecretHash: activationSecretHash,
      paymentActivationSecretExpiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
      verificationAttempts: 0,
      verificationMethod: undefined,
      verifiedAt: undefined,
    } as PaymentMethodDto;
    return { payment: normalizedPayment, paymentActivationSecret: activationSecret };
  }
}
