import { ParticipantType } from '@prisma/client';
import * as crypto from 'crypto';
import { IdempotencyContextBase } from './idempotency-context.base';

export abstract class IdempotencyKeysBase extends IdempotencyContextBase {
  protected generateIdempotencyKey(settlementId: string, party: ParticipantType, recipientMerchantId?: string): string {
    const keyComponents = [settlementId, party, recipientMerchantId || 'no-recipient'].join('::');
    return crypto.createHash('sha256').update(keyComponents).digest('hex');
  }

  protected generatePayoutReference(merchantTransactionReference: string, party: ParticipantType): string {
    return `${merchantTransactionReference}-${party}-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
  }
}
