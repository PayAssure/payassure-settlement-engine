import {
  Injectable,
  BadRequestException,
  UnauthorizedException,
  NotFoundException,
  ForbiddenException,
  ConflictException,
  InternalServerErrorException,
} from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import * as crypto from 'crypto';
import { SettlementRepository } from './settlement.repository';
import { AuthenticateDto } from './dto/authenticate.dto';
import { InitiateSettlementDto } from './dto/initiate-settlement.dto';
import { ReconcileSettlementDto } from './dto/reconcile-settlement.dto';
import {
  AuthenticateResponseDto,
  SettlementResponseDto,
  TrackSettlementResponseDto,
  ReconcileResponseDto,
} from './dto/settlement-response.dto';

@Injectable()
export class SettlementService {
  private prisma: PrismaClient;
  private readonly TOKEN_EXPIRY = 3600; // 1 hour in seconds

  constructor(private readonly repository: SettlementRepository) {
    this.prisma = new PrismaClient();
  }

  /**
   * STEP 1: Authenticate Business with API Key & Secret
   * Validates credentials and generates one-time token
   */
  async authenticate(data: AuthenticateDto): Promise<AuthenticateResponseDto> {
    const integration = await this.prisma.integration.findFirst({
      where: { apiKey: data.apiKey, isActive: true },
      include: { participant: true },
    });

    if (!integration) {
      throw new NotFoundException({
        statusCode: 404,
        message: 'Business not found with provided API key',
        error: 'BUSINESS_NOT_FOUND',
      });
    }

    const apiSecretHash = this.hashCredential(data.apiSecret);

    if (apiSecretHash !== integration.apiSecretHash) {
      throw new UnauthorizedException({
        statusCode: 401,
        message: 'Invalid API credentials',
        error: 'INVALID_CREDENTIALS',
      });
    }

    // Check if business is in LIVE status
    if (integration.participant.status !== 'LIVE') {
      throw new ForbiddenException({
        statusCode: 403,
        message: 'Business account is not in LIVE status',
        error: 'BUSINESS_NOT_ACTIVE',
      });
    }

    // Generate one-time token
    const token = this.generateOneTimeToken();
    const expiresAt = new Date(Date.now() + this.TOKEN_EXPIRY * 1000);

    // Store session in database
    await this.repository.createSettlementSession(
      integration.participantId,
      integration.id,
      token,
      expiresAt,
    );

    return {
      success: true,
      token,
      expiresIn: this.TOKEN_EXPIRY,
      tokenType: 'Bearer',
      business: {
        id: integration.participantId,
        businessName: integration.participant.businessName,
        participantType: integration.participant.participantType,
        status: integration.participant.status,
      },
    };
  }

  /**
   * STEP 2: Initiate Settlement with One-Time Token
   * Validates token, creates settlement, and marks token as used
   */
  async initiateSettlement(token: string, data: InitiateSettlementDto): Promise<SettlementResponseDto> {
    // Validate token
    const session = await this.validateAndGetSession(token);

    try {
      // Check if settlement with this reference already exists
      const existingSettlement = await this.repository.findSettlementByBusinessAndReference(
        session.businessId,
        data.reference,
      );

      if (existingSettlement) {
        throw new ConflictException({
          statusCode: 409,
          message: 'Settlement with this reference already exists',
          error: 'DUPLICATE_REFERENCE',
        });
      }

      // Validate settlement data
      this.validateSettlementData(data);

      // Create settlement record
      const settlement = await this.repository.createSettlement(
        session.businessId,
        session.integrationId,
        data,
      );

      // Create transactions if provided
      if (data.transactionItems && data.transactionItems.length > 0) {
        await this.repository.createMultipleTransactions(
          settlement.id,
          data.transactionItems.map((item) => ({
            itemId: item.itemId,
            type: item.type,
            amount: item.amount,
            description: item.description,
          })),
        );
      }

      // Mark token as used (one-time use only)
      await this.repository.markSessionAsUsed(session.id);

      return {
        success: true,
        settlement: {
          settlementId: settlement.id,
          status: settlement.status,
          amount: Number(settlement.amount),
          currency: settlement.currency,
          reference: settlement.reference,
          createdAt: settlement.createdAt,
          estimatedProcessingTime: '24-48 hours',
        },
        message: 'Settlement request received and queued for processing',
      };
    } catch (error) {
      if (
        error instanceof BadRequestException ||
        error instanceof ConflictException ||
        error instanceof ForbiddenException
      ) {
        throw error;
      }
      throw new InternalServerErrorException({
        statusCode: 500,
        message: 'Failed to initiate settlement',
        error: 'INITIATION_FAILED',
      });
    }
  }

  /**
   * STEP 3: Track Settlement Status
   * Retrieve current status and transaction details
   */
  async trackSettlement(settlementId: string): Promise<TrackSettlementResponseDto> {
    const settlement = await this.repository.findSettlementById(settlementId);

    if (!settlement) {
      throw new NotFoundException({
        statusCode: 404,
        message: 'Settlement not found',
        error: 'SETTLEMENT_NOT_FOUND',
      });
    }

    // Get business information
    const participant = await this.prisma.onboardingParticipant.findUnique({
      where: { id: settlement.businessId },
    });

    return {
      success: true,
      settlement: {
        settlementId: settlement.id,
        businessId: settlement.businessId,
        businessName: participant?.businessName,
        status: settlement.status,
        amount: Number(settlement.amount),
        currency: settlement.currency,
        reference: settlement.reference,
        createdAt: settlement.createdAt,
        processedAt: settlement.processedAt ?? undefined,
        estimatedCompletionTime: new Date(settlement.createdAt.getTime() + 48 * 60 * 60 * 1000),
        transactions: settlement.transactions.map((txn) => ({
          transactionId: txn.id,
          itemId: txn.itemId,
          type: txn.type,
          amount: Number(txn.amount),
          description: txn.description ?? undefined,
          status: txn.status,
        })),
      },
    };
  }

  /**
   * STEP 4: Get Transaction Details
   * Retrieve specific transaction information
   */
  async getTransaction(transactionId: string) {
    const transaction = await this.repository.findTransactionById(transactionId);

    if (!transaction) {
      throw new NotFoundException({
        statusCode: 404,
        message: 'Transaction not found',
        error: 'TRANSACTION_NOT_FOUND',
      });
    }

    return {
      success: true,
      transaction: {
        transactionId: transaction.id,
        settlementId: transaction.settlementId,
        itemId: transaction.itemId,
        type: transaction.type,
        amount: Number(transaction.amount),
        currency: 'KES',
        status: transaction.status,
        description: transaction.description,
        createdAt: transaction.createdAt,
        completedAt: transaction.completedAt,
      },
    };
  }

  /**
   * STEP 5: Reconcile Settlement
   * Submit bank confirmation and mark as completed
   */
  async reconcileSettlement(data: ReconcileSettlementDto): Promise<ReconcileResponseDto> {
    const settlement = await this.repository.findSettlementById(data.settlementId);

    if (!settlement) {
      throw new NotFoundException({
        statusCode: 404,
        message: 'Settlement not found',
        error: 'SETTLEMENT_NOT_FOUND',
      });
    }

    // Update with reconciliation data
    const updatedSettlement = await this.repository.updateSettlementReconciliation(
      data.settlementId,
      data.bankReference,
      data.bankTransactionId,
    );

    return {
      success: true,
      settlement: {
        settlementId: updatedSettlement.id,
        status: updatedSettlement.status,
        reconciliationStatus: updatedSettlement.reconciliationStatus ?? undefined,
        reconciliationDetails: {
          bankReference: updatedSettlement.bankReference ?? '',
          reconcileAt: updatedSettlement.reconciliedAt ?? updatedSettlement.completedAt ?? updatedSettlement.createdAt,
        },
      },
    };
  }

  /**
   * Helper: Validate and retrieve session by token
   * Ensures token exists, is not expired, and has not been used
   */
  private async validateAndGetSession(token: string) {
    const session = await this.repository.findSettlementSessionByToken(token);

    if (!session) {
      throw new UnauthorizedException({
        statusCode: 401,
        message: 'Invalid or expired one-time token',
        error: 'INVALID_TOKEN',
      });
    }

    if (session.isUsed) {
      throw new UnauthorizedException({
        statusCode: 401,
        message: 'One-time token has already been used',
        error: 'TOKEN_ALREADY_USED',
      });
    }

    if (session.expiresAt < new Date()) {
      throw new UnauthorizedException({
        statusCode: 401,
        message: 'One-time token has expired',
        error: 'TOKEN_EXPIRED',
      });
    }

    return session;
  }

  /**
   * Helper: Validate settlement data
   */
  private validateSettlementData(data: InitiateSettlementDto) {
    if (data.amount <= 0) {
      throw new BadRequestException({
        statusCode: 400,
        message: 'Validation failed',
        error: 'VALIDATION_ERROR',
        errors: [
          {
            field: 'amount',
            message: 'Amount must be greater than 0',
          },
        ],
      });
    }

    if (!data.currency) {
      throw new BadRequestException({
        statusCode: 400,
        message: 'Validation failed',
        error: 'VALIDATION_ERROR',
        errors: [
          {
            field: 'currency',
            message: 'Currency is required',
          },
        ],
      });
    }

    if (!data.settlementMethod) {
      throw new BadRequestException({
        statusCode: 400,
        message: 'Validation failed',
        error: 'VALIDATION_ERROR',
        errors: [
          {
            field: 'settlementMethod',
            message: 'Settlement method is required',
          },
        ],
      });
    }

    if (!data.reference) {
      throw new BadRequestException({
        statusCode: 400,
        message: 'Validation failed',
        error: 'VALIDATION_ERROR',
        errors: [
          {
            field: 'reference',
            message: 'Reference is required',
          },
        ],
      });
    }
  }

  /**
   * Helper: Generate secure one-time token
   */
  private generateOneTimeToken(): string {
    return `one_time_${Date.now()}_${crypto.randomBytes(16).toString('hex')}`;
  }

  /**
   * Helper: Hash credential (API key or secret)
   */
  private hashCredential(credential: string): string {
    return crypto.createHash('sha256').update(credential).digest('hex');
  }

  async onModuleDestroy() {
    await this.prisma.$disconnect();
  }
}
