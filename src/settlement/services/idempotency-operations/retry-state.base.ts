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
    const resultCode = callbackData.resultCode ?? callbackData.ResultCode ?? callbackData.Result?.ResultCode;
    const hasResultCode = resultCode !== undefined && resultCode !== null && String(resultCode).trim() !== '';
    const status = !hasResultCode
      ? 'UNKNOWN'
      : Number(resultCode) === 0
        ? 'SUCCESSFUL'
        : 'FAILED';
    await this.prisma.b2BPayoutAttempt.updateMany({
      where: { id: attempt.id, status: { in: ['PENDING', 'SUBMITTED', 'UNKNOWN'] } },
      data: {
        status,
        callbackReceived: true,
        callbackReceivedAt: new Date(),
        metadata: { ...(typeof attempt.metadata === 'object' ? attempt.metadata : {}), callbackData },
      },
    });
    this.logger.log('[IDEMPOTENCY] Callback received for payout', {
      idempotencyKey,
      payoutReference: attempt.payoutReference,
      status,
    });
  }

  async markStalePayoutAttemptsUnknown(
    timeoutMs = 15 * 60 * 1000,
  ): Promise<Array<{ id: string; settlementId: string; payoutReference: string }>> {
    const staleBefore = new Date(Date.now() - timeoutMs);
    const staleAttempts = await this.prisma.b2BPayoutAttempt.findMany({
      where: { status: 'SUBMITTED', updatedAt: { lte: staleBefore } },
      select: { id: true, settlementId: true, payoutReference: true },
    });
    const marked: Array<{ id: string; settlementId: string; payoutReference: string }> = [];
    for (const attempt of staleAttempts) {
      const update = await this.prisma.b2BPayoutAttempt.updateMany({
        where: { id: attempt.id, status: 'SUBMITTED', updatedAt: { lte: staleBefore } },
        data: {
          status: 'UNKNOWN',
          failureReason: 'No final M-Pesa payout callback was received before the reconciliation timeout',
        },
      });
      if (update.count === 1) marked.push(attempt);
    }
    return marked;
  }
}
