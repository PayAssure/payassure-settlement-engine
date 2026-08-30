import { Injectable, Logger, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaClient, B2BPayoutStatus, ParticipantType, Prisma } from '@prisma/client';
import * as crypto from 'crypto';

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

@Injectable()
export class B2BPayoutIdempotencyService {
  private prisma: PrismaClient;
  private readonly logger = new Logger(B2BPayoutIdempotencyService.name);

  constructor() {
    this.prisma = new PrismaClient();
  }

  /**
   * Generate a unique idempotency key for a payout
   * Using settlementId + party + recipientMerchantId ensures one payout per party per settlement
   */
  private generateIdempotencyKey(
    settlementId: string,
    party: ParticipantType,
    recipientMerchantId?: string
  ): string {
    const keyComponents = [settlementId, party, recipientMerchantId || 'no-recipient'].join('::');
    return crypto.createHash('sha256').update(keyComponents).digest('hex');
  }

  /**
   * Create or retrieve a payout attempt record
   * Returns the existing attempt if it already exists (idempotency)
   */
  async createOrGetPayoutAttempt(data: CreatePayoutAttemptDto): Promise<PayoutAttemptResult> {
    const idempotencyKey = this.generateIdempotencyKey(data.settlementId, data.party, data.recipientMerchantId);

    // Check if this payout has already been attempted
    const existingAttempt = await this.prisma.b2BPayoutAttempt.findUnique({
      where: { idempotencyKey },
    });

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

    // Create new payout attempt
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

  /**
   * Update payout attempt status after gateway response
   */
  async updatePayoutAttemptStatus(
    idempotencyKey: string,
    status: B2BPayoutStatus,
    gatewayResponse?: {
      responseCode?: string;
      responseDescription?: string;
      response?: any;
    }
  ): Promise<void> {
    const attempt = await this.prisma.b2BPayoutAttempt.findUnique({
      where: { idempotencyKey },
    });

    if (!attempt) {
      throw new NotFoundException(`Payout attempt not found: ${idempotencyKey}`);
    }

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

    this.logger.log('[IDEMPOTENCY] Payout attempt status updated', {
      idempotencyKey,
      status,
      responseCode: gatewayResponse?.responseCode,
    });
  }

  /**
   * Check if a payout has already been completed
   */
  async isPayoutCompleted(idempotencyKey: string): Promise<boolean> {
    const attempt = await this.prisma.b2BPayoutAttempt.findUnique({
      where: { idempotencyKey },
    });

    return attempt?.status === 'COMPLETED' || attempt?.callbackReceived === true;
  }

  /**
   * Check if payout can be retried
   */
  async canRetry(idempotencyKey: string, maxRetries: number = 5): Promise<boolean> {
    const attempt = await this.prisma.b2BPayoutAttempt.findUnique({
      where: { idempotencyKey },
    });

    if (!attempt) {
      throw new NotFoundException(`Payout attempt not found: ${idempotencyKey}`);
    }

    // Don't retry if already completed or received callback
    if (attempt.status === 'COMPLETED' || attempt.callbackReceived) {
      return false;
    }

    // Check max retries
    if (attempt.attemptCount >= maxRetries) {
      return false;
    }

    // Check if next retry time has passed
    if (attempt.nextRetryAt && attempt.nextRetryAt > new Date()) {
      return false;
    }

    return true;
  }

  /**
   * Schedule next retry for a failed payout
   */
  async scheduleRetry(
    idempotencyKey: string,
    delayMs: number,
    failureReason?: string
  ): Promise<void> {
    const attempt = await this.prisma.b2BPayoutAttempt.findUnique({
      where: { idempotencyKey },
    });

    if (!attempt) {
      throw new NotFoundException(`Payout attempt not found: ${idempotencyKey}`);
    }

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

  /**
   * Mark payout as completed with callback
   */
  async markCallbackReceived(
    idempotencyKey: string,
    callbackData: Record<string, any>
  ): Promise<void> {
    const attempt = await this.prisma.b2BPayoutAttempt.findUnique({
      where: { idempotencyKey },
    });

    if (!attempt) {
      throw new NotFoundException(`Payout attempt not found: ${idempotencyKey}`);
    }

    await this.prisma.b2BPayoutAttempt.update({
      where: { id: attempt.id },
      data: {
        status: 'COMPLETED',
        callbackReceived: true,
        callbackReceivedAt: new Date(),
        metadata: {
          ...(typeof attempt.metadata === 'object' ? attempt.metadata : {}),
          callbackData,
        },
      },
    });

    this.logger.log('[IDEMPOTENCY] Callback received for payout', {
      idempotencyKey,
      payoutReference: attempt.payoutReference,
    });
  }

  /**
   * Get all pending retries
   */
  async getPendingRetries(): Promise<any[]> {
    return this.prisma.b2BPayoutAttempt.findMany({
      where: {
        status: { in: ['FAILED', 'RETRYING'] },
        nextRetryAt: { lte: new Date() },
      },
      orderBy: { nextRetryAt: 'asc' },
    });
  }

  /**
   * Get payout attempt by idempotency key
   */
  async getPayoutAttempt(idempotencyKey: string): Promise<any> {
    return this.prisma.b2BPayoutAttempt.findUnique({
      where: { idempotencyKey },
    });
  }

  /**
   * Get payout attempts for a settlement
   */
  async getSettlementPayouts(settlementId: string): Promise<any[]> {
    return this.prisma.b2BPayoutAttempt.findMany({
      where: { settlementId },
      orderBy: { createdAt: 'desc' },
    });
  }

  private generatePayoutReference(merchantTransactionReference: string, party: ParticipantType): string {
    return `${merchantTransactionReference}-${party}-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
  }

  async onModuleDestroy() {
    await this.prisma.$disconnect();
  }
}
