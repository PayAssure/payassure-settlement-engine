import { Prisma } from '@prisma/client';
import type { CreatePayoutAttemptDto, PayoutAttemptResult } from './types';
import { IdempotencyKeysBase } from './idempotency-keys.base';

export abstract class PayoutAttemptCreationBase extends IdempotencyKeysBase {
  async createOrGetPayoutAttempt(data: CreatePayoutAttemptDto): Promise<PayoutAttemptResult> {
    const idempotencyKey = this.generateIdempotencyKey(data.settlementId, data.party, data.recipientMerchantId);
    const existingAttempt = await this.prisma.b2BPayoutAttempt.findUnique({ where: { idempotencyKey } });
    if (existingAttempt) {
      this.logger.log('[IDEMPOTENCY] Payout attempt already exists', {
        idempotencyKey,
        payoutReference: existingAttempt.payoutReference,
        status: existingAttempt.status,
        attemptCount: existingAttempt.attemptCount,
      });
      return {
        id: existingAttempt.id,
        payoutReference: existingAttempt.payoutReference,
        idempotencyKey,
        status: existingAttempt.status,
        isNewAttempt: false,
        attemptCount: existingAttempt.attemptCount,
        lastAttemptAt: existingAttempt.lastAttemptAt,
      };
    }
    const payoutReference = this.generatePayoutReference(data.merchantTransactionReference, data.party);
    const newAttempt = await this.prisma.b2BPayoutAttempt.create({
      data: {
        settlementId: data.settlementId,
        merchantTransactionReference: data.merchantTransactionReference,
        payoutReference,
        idempotencyKey,
        party: data.party,
        amount: new Prisma.Decimal(data.amount),
        recipientMerchantId: data.recipientMerchantId,
        recipientType: data.recipientType || 'MPESA',
        recipientPhone: data.recipientPhone,
        callbackIdentifier: data.callbackIdentifier,
        status: 'PENDING',
        metadata: data.metadata || {},
      },
    });
    this.logger.log('[IDEMPOTENCY] New payout attempt created', {
      idempotencyKey,
      payoutReference: newAttempt.payoutReference,
      settlementId: data.settlementId,
      party: data.party,
      amount: data.amount,
    });
    return {
      id: newAttempt.id,
      payoutReference,
      idempotencyKey,
      status: 'PENDING',
      isNewAttempt: true,
      attemptCount: 1,
      lastAttemptAt: newAttempt.lastAttemptAt,
    };
  }
}
