import { randomUUID } from 'node:crypto';
import { Prisma } from '@prisma/client';
import type { CreatePayoutAttemptDto, PayoutAttemptResult } from './types';
import { IdempotencyKeysBase } from './idempotency-keys.base';

export abstract class PayoutAttemptCreationBase extends IdempotencyKeysBase {
  async createOrGetPayoutAttempt(data: CreatePayoutAttemptDto): Promise<PayoutAttemptResult> {
    const idempotencyKey = this.generateIdempotencyKey(data.settlementId, data.party, data.recipientMerchantId);
    const payoutReference = this.generatePayoutReference(data.merchantTransactionReference, data.party);
    const newId = randomUUID();
    const attempt = await this.prisma.b2BPayoutAttempt.upsert({
      where: { idempotencyKey },
      create: {
        id: newId,
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
      update: {},
    });
    const isNewAttempt = attempt.id === newId;
    if (!isNewAttempt) {
      this.logger.log('[IDEMPOTENCY] Payout attempt already exists', {
        idempotencyKey,
        payoutReference: attempt.payoutReference,
        status: attempt.status,
        attemptCount: attempt.attemptCount,
      });
    }
    if (isNewAttempt) {
      this.logger.log('[IDEMPOTENCY] New payout attempt created', {
        idempotencyKey,
        payoutReference: attempt.payoutReference,
        settlementId: data.settlementId,
        party: data.party,
        amount: data.amount,
      });
    }
    return {
      id: attempt.id,
      payoutReference: attempt.payoutReference,
      idempotencyKey,
      status: attempt.status,
      isNewAttempt,
      attemptCount: attempt.attemptCount,
      lastAttemptAt: attempt.lastAttemptAt,
      callbackIdentifier: attempt.callbackIdentifier,
    };
  }
}
