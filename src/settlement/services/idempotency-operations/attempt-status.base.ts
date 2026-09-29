import { B2BPayoutStatus } from '@prisma/client';
import { NotFoundException } from '@nestjs/common';
import { PayoutAttemptCreationBase } from './attempt-creation.base';

export abstract class PayoutAttemptStatusBase extends PayoutAttemptCreationBase {
  async updatePayoutAttemptStatus(idempotencyKey: string, status: B2BPayoutStatus, gatewayResponse?: {
    responseCode?: string;
    responseDescription?: string;
    response?: any;
  }): Promise<void> {
    const attempt = await this.prisma.b2BPayoutAttempt.findUnique({ where: { idempotencyKey } });
    if (!attempt) throw new NotFoundException(`Payout attempt not found: ${idempotencyKey}`);
    await this.prisma.b2BPayoutAttempt.update({
      where: { id: attempt.id },
      data: {
        status,
        gatewayResponseCode: gatewayResponse?.responseCode,
        gatewayResponseDescription: gatewayResponse?.responseDescription,
        gatewayResponse: gatewayResponse?.response,
        lastAttemptAt: new Date(),
      },
    });
    this.logger.log('[IDEMPOTENCY] Payout attempt status updated', { idempotencyKey, status, responseCode: gatewayResponse?.responseCode });
  }

  async isPayoutCompleted(idempotencyKey: string): Promise<boolean> {
    const attempt = await this.prisma.b2BPayoutAttempt.findUnique({ where: { idempotencyKey } });
    return attempt?.status === 'COMPLETED' || attempt?.callbackReceived === true;
  }

  async canRetry(idempotencyKey: string, maxRetries: number = 5): Promise<boolean> {
    const attempt = await this.prisma.b2BPayoutAttempt.findUnique({ where: { idempotencyKey } });
    if (!attempt) throw new NotFoundException(`Payout attempt not found: ${idempotencyKey}`);
    if (attempt.status === 'COMPLETED' || attempt.callbackReceived) return false;
    if (attempt.attemptCount >= maxRetries) return false;
    if (attempt.nextRetryAt && attempt.nextRetryAt > new Date()) return false;
    return true;
  }
}
