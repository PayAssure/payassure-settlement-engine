import { B2BPayoutStatus, ParticipantType } from '@prisma/client';

export interface CreatePayoutAttemptDto {
  settlementId: string;
  merchantTransactionReference: string;
  party: ParticipantType;
  amount: number;
  recipientMerchantId?: string;
  recipientType?: string;
  recipientPhone?: string;
  callbackIdentifier?: string;
  metadata?: Record<string, any>;
}

export interface PayoutAttemptResult {
  id: string;
  payoutReference: string;
  idempotencyKey: string;
  status: B2BPayoutStatus;
  isNewAttempt: boolean;
  attemptCount: number;
  lastAttemptAt: Date;
}
