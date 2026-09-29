import { createHash } from 'crypto';
import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { OnbordingsParticipantUpdatesBase } from './participant-updates.base';

export abstract class OnbordingsPaymentActivationBase extends OnbordingsParticipantUpdatesBase {
  async activatePayment(id: string, paymentActivationSecret: string) {
    const participant = await this.prisma.onboardingParticipant.findUnique({
      where: { id },
      include: { integrations: { orderBy: { createdAt: 'desc' }, take: 1 } },
    });
    if (!participant) throw new NotFoundException('Participant not found');
    const payment = participant.payment as any;
    if (!payment) throw new ForbiddenException('Participant payment destination is not configured');
    if (payment.status !== 'PENDING_VERIFICATION') throw new ForbiddenException('Participant payment destination is not pending verification');
    const activationSecretHash = payment.paymentActivationSecretHash;
    const expiresAt = payment.paymentActivationSecretExpiresAt;
    if (!activationSecretHash || !expiresAt) throw new ForbiddenException('Payment activation secret is not available');
    const expiryTime = new Date(expiresAt);
    if (Number.isNaN(expiryTime.getTime()) || expiryTime.getTime() <= Date.now()) {
      throw new ForbiddenException('Payment activation secret has expired');
    }
    const providedHash = createHash('sha256').update(paymentActivationSecret).digest('hex');
    if (providedHash !== activationSecretHash) {
      const nextPayment = { ...payment, verificationAttempts: (payment.verificationAttempts ?? 0) + 1 };
      await this.prisma.onboardingParticipant.update({
        where: { id },
        data: { payment: nextPayment as Prisma.InputJsonValue },
      });
      throw new ForbiddenException('Invalid payment activation secret');
    }
    const verifiedPayment = {
      ...payment,
      status: 'VERIFIED',
      isVerified: true,
      verificationMethod: 'PAYMENT_ACTIVATION_SECRET',
      verifiedAt: new Date().toISOString(),
      verificationAttempts: payment.verificationAttempts ?? 0,
    };
    return this.prisma.onboardingParticipant.update({
      where: { id },
      data: { payment: verifiedPayment as Prisma.InputJsonValue },
      include: { integrations: { orderBy: { createdAt: 'desc' }, take: 1 } },
    });
  }

  async deleteParticipant(id: string) {
    const participant = await this.prisma.onboardingParticipant.findUnique({ where: { id } });
    if (!participant) throw new NotFoundException('Participant not found');
    return this.prisma.onboardingParticipant.delete({ where: { id } });
  }
}
