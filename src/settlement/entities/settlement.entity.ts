import { SettlementStatus, TransactionStatus, TransactionType } from '@prisma/client';

export class SettlementEntity {
  id: string = '';
  businessId: string = '';
  integrationId: string = '';
  amount: number = 0;
  currency: string = '';
  settlementMethod: string = '';
  settlementAccount: string = '';
  reference: string = '';
  status: SettlementStatus = SettlementStatus.INITIATED;
  description?: string = '';
  bankReference?: string = '';
  bankTransactionId?: string = '';
  reconciliationStatus?: string = '';
  failureReason?: string = '';
  metadata?: Record<string, any> = {};
  createdAt: Date = new Date();
  processedAt?: Date;
  completedAt?: Date;
  failedAt?: Date;
  reconciliedAt?: Date;
}

export class TransactionEntity {
  id: string = '';
  settlementId: string = '';
  itemId: string = '';
  type: TransactionType = TransactionType.SALE;
  amount: number = 0;
  description?: string = '';
  status: TransactionStatus = TransactionStatus.INITIATED;
  createdAt: Date = new Date();
  completedAt?: Date;
}

export class SettlementSessionEntity {
  id: string = '';
  businessId: string = '';
  integrationId: string = '';
  token: string = '';
  expiresAt: Date = new Date();
  usedAt?: Date;
  isUsed: boolean = false;
  createdAt: Date = new Date();
}
