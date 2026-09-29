import { NotFoundException } from '@nestjs/common';
import { PayoutAttemptStatusBase } from './attempt-status.base';

export abstract class PayoutRetryStateBase extends PayoutAttemptStatusBase {
  async scheduleRetry(idempotencyKey: string, delayMs: number, failureReason?: string): Promise<void> {
    const attempt = await this.prisma.b2BPayoutAttempt.findUnique({ where: { idempotencyKey } });
    if (!attempt) throw new NotFoundException(`Payout attempt not found: ${idempotencyKey}`);
    const nextRetryAt = new Date(Date.now() + delayMs);
    await this.prisma.b2BPayoutAttempt.update({
      where: { id: attempt.id },
      data: {
        status: 'RETRYING',
        attemptCount: attempt.attemptCount + 1,
        nextRetryAt,
        failureReason,
        lastAttemptAt: new Date(),
      },
    });
    this.logger.log('[RETRY] Payout scheduled for retry', {
      idempotencyKey,
      attemptCount: attempt.attemptCount + 1,
      nextRetryAt,
      delayMs,
    });
  }

  async markCallbackReceived(idempotencyKey: string, callbackData: Record<string, any>): Promise<void> {
    const attempt = await this.prisma.b2BPayoutAttempt.findUnique({ where: { idempotencyKey } });
    if (!attempt) throw new NotFoundException(`Payout attempt not found: ${idempotencyKey}`);
    await this.prisma.b2BPayoutAttempt.update({
      where: { id: attempt.id },
      data: {
        status: 'COMPLETED',
        callbackReceived: true,
        callbackReceivedAt: new Date(),
        metadata: { ...(typeof attempt.metadata === 'object' ? attempt.metadata : {}), callbackData },
      },
    });
    this.logger.log('[IDEMPOTENCY] Callback received for payout', { idempotencyKey, payoutReference: attempt.payoutReference });
  }
}
