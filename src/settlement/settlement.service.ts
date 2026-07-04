import {
  Injectable,
  BadRequestException,
  UnauthorizedException,
  NotFoundException,
  ForbiddenException,
  ConflictException,
  InternalServerErrorException,
  Logger,
} from '@nestjs/common';
import { ParticipantStatus, ParticipantType, PrismaClient } from '@prisma/client';
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
  private readonly logger = new Logger(SettlementService.name);
  private readonly TOKEN_EXPIRY = 3600; // 1 hour in seconds
  private readonly SUPPORTED_CURRENCIES = ['KES', 'USD', 'TZS'];

  constructor(private readonly repository: SettlementRepository) {
    this.prisma = new PrismaClient();
  }

  /**
   * STEP 1: Authenticate Business with API Key & Secret
   * Validates credentials and generates one-time token
   */
  async authenticate(data: AuthenticateDto, user: any): Promise<AuthenticateResponseDto> {
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

    // Validate that the authenticated token belongs to the user associated with this integration's participant
    if (user && integration.participant && integration.participant.email) {
      const tokenEmail = (user && user.email) || '';
      if (tokenEmail !== integration.participant.email) {
        throw new UnauthorizedException({
          statusCode: 401,
          message: 'Authenticated token does not belong to the owner of the provided API credentials',
          error: 'INVALID_TOKEN_FOR_API_KEYS',
        });
      }
    }

    const apiSecretHash = this.hashCredential(data.apiSecret);

    if (apiSecretHash !== integration.apiSecretHash) {
      throw new UnauthorizedException({
        statusCode: 401,
        message: 'Invalid API credentials',
        error: 'INVALID_CREDENTIALS',
      });
    }

    // Check if business is in ACTIVE status
    if (integration.participant.status !== ParticipantStatus.ACTIVE) {
      throw new ForbiddenException({
        statusCode: 403,
        message: 'Business account is not active',
        error: 'BUSINESS_NOT_ACTIVE',
      });
    }

    this.logger.log(`Business authentication passed for integrationId=${integration.id}, participantEmail=${integration.participant.email}`);

    // Generate reusable session token valid for one hour
    const token = this.generateSessionToken();
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
    this.logger.log(`Initiate settlement requested: session=${token}, merchantTransactionReference=${data.merchantTransactionReference}`);
    const session = await this.validateAndGetSession(token);
    this.logger.log(`Settlement session validated for business=${session.businessId}, integration=${session.integrationId}`);

    const integration = await this.repository.findIntegrationById(session.integrationId);

    if (!integration || !integration.participant) {
      this.logger.warn(`Invalid session context: session=${token}, integrationId=${session.integrationId}`);
      throw new UnauthorizedException({
        statusCode: 401,
        message: 'Invalid session or retailer context',
        error: 'INVALID_SESSION',
      });
    }

    const retailerMerchantId = integration.merchantId;
    this.logger.log(`Authenticated retailer merchantId=${retailerMerchantId}, participant=${integration.participant.id}`);

    if (
      integration.participant.participantType !== ParticipantType.RETAILER ||
      !([ParticipantStatus.ACTIVE, ParticipantStatus.LIVE] as ParticipantStatus[]).includes(
        integration.participant.status,
      )
    ) {
      this.logger.warn(`Retailer not authorized or inactive: merchantId=${retailerMerchantId}, status=${integration.participant.status}`);
      throw new ForbiddenException({
        statusCode: 403,
        message: 'Retailer account is not authorized to initiate settlements',
        error: 'RETAILER_NOT_AUTHORIZED',
      });
    }

    try {
      this.logger.log(`Checking for existing settlement for business=${session.businessId}, reference=${data.merchantTransactionReference}`);
      const existingSettlement = await this.repository.findSettlementByBusinessAndPayloadReference(
        session.businessId,
        data.merchantTransactionReference,
      );

      if (existingSettlement) {
        this.logger.log(`Existing settlement found for reference=${data.merchantTransactionReference}, settlementId=${existingSettlement.id}`);
        await this.repository.markSessionAsUsed(session.id);
        return {
          success: true,
          settlement: {
            settlementId: existingSettlement.id,
            status: existingSettlement.status,
            amount: Number(existingSettlement.amount),
            currency: existingSettlement.currency,
            reference: existingSettlement.reference,
            createdAt: existingSettlement.createdAt,
            estimatedProcessingTime: '10 minutes',
            transactions: existingSettlement.transactions.map((txn) => ({
              transactionId: txn.id,
              itemId: txn.itemId,
              type: txn.type,
              amount: Number(txn.amount),
              description: txn.description ?? undefined,
              status: txn.status,
            })),
          },
          message: 'Settlement already processed for this merchant transaction reference',
        };
      }

      this.logger.log(`No existing settlement found, validating request payload for merchantTransactionReference=${data.merchantTransactionReference}`);
      await this.validateSettlementData(data);
      this.logger.log(`Payload validation passed for merchantTransactionReference=${data.merchantTransactionReference}`);

      const payAssureReference = this.generatePayAssureReference();
      const internalMerchantTransactionReference = this.generateInternalMerchantTransactionReference();
      this.logger.log(`Creating primary settlement with payAssureReference=${payAssureReference}, internalReference=${internalMerchantTransactionReference}`);
      const primarySettlement = await this.repository.createSettlement(
        session.businessId,
        session.integrationId,
        payAssureReference,
        internalMerchantTransactionReference,
        data,
      );

      await this.repository.markSessionAsUsed(session.id);
      this.logger.log(`Session marked as used for sessionId=${session.id}`);

      const childSettlements = [] as Array<{ id: string; amount: number; reference: string; supplierMerchantId: string }>;

      for (const supplier of data.suppliers) {
        this.logger.log(`Processing supplier ${supplier.supplierMerchantId} for settlement ${primarySettlement.id}`);
        const supplierAmount = supplier.items.reduce((sum, item) => sum + item.supplierAmount, 0);
        this.logger.log(`Supplier ${supplier.supplierMerchantId} amount=${supplierAmount}, itemCount=${supplier.items.length}`);
        const supplierMerchantTransactionReference = `${internalMerchantTransactionReference}-${supplier.supplierMerchantId}`;

        const supplierIntegration = await this.prisma.integration.findFirst({
          where: {
            merchantId: supplier.supplierMerchantId,
            isActive: true,
          },
          include: { participant: true },
        });

        const paymentSnapshot = supplierIntegration?.participant?.payment ?? null;

        const settlement = await this.repository.createSupplierSettlement(
          session.businessId,
          session.integrationId,
          {
            amount: supplierAmount,
            currency: data.currency,
            settlementMethod: data.settlementMethod,
            reference: `${data.merchantTransactionReference}-${supplier.supplierMerchantId}`,
            merchantTransactionReference: supplierMerchantTransactionReference,
            description: data.description,
            metadata: {
              ...(data.metadata ?? {}),
              originalMerchantReference: data.merchantTransactionReference,
              parentSettlementId: primarySettlement.id,
              supplierMerchantId: supplier.supplierMerchantId,
              retailerMerchantId,
            },
            paymentSnapshot,
          },
        );

        await this.repository.createMultipleTransactions(
          settlement.id,
          supplier.items.map((item) => ({
            itemId: item.itemId,
            supplierMerchantId: supplier.supplierMerchantId,
            type: 'SALE',
            amount: item.supplierAmount,
            quantity: item.quantity,
            unitPrice: item.unitPrice,
            description: item.description,
          })),
        );

        this.logger.log(`Created supplier settlement ${settlement.id} for supplier ${supplier.supplierMerchantId}`);
        childSettlements.push({
          id: settlement.id,
          amount: supplierAmount,
          reference: settlement.reference,
          supplierMerchantId: supplier.supplierMerchantId,
        });
      }

      return {
        success: true,
        settlement: {
          settlementId: primarySettlement.id,
          status: primarySettlement.status,
          amount: Number(primarySettlement.amount),
          currency: primarySettlement.currency,
          reference: primarySettlement.reference,
          createdAt: primarySettlement.createdAt,
          estimatedProcessingTime: '24-48 hours',
        },
        message: 'Settlement request received and queued for processing',
        children: childSettlements,
      };
    } catch (error) {
      if (
        error instanceof BadRequestException ||
        error instanceof ConflictException ||
        error instanceof ForbiddenException
      ) {
        throw error;
      }

      const err = error as Error;
      const contextData = {
        requestBody: data,
        settlementSessionToken: token,
      };

      this.logger.error(
        `Settlement initiation failed: ${err.message ?? 'Unknown error'} | context=${JSON.stringify(contextData)}`,
        err.stack,
      );
      this.logger.log(`Settlement initiation flow ended with error for merchantTransactionReference=${data.merchantTransactionReference}`);

      throw new InternalServerErrorException({
        statusCode: 500,
        message: 'An error occurred while initiating settlement. Please check logs for details.',
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
      this.logger.warn(`Settlement token validation failed: token=${token} not found`);
      throw new UnauthorizedException({
        statusCode: 401,
        message: 'Invalid or expired one-time token',
        error: 'INVALID_TOKEN',
      });
    }

    if (session.expiresAt < new Date()) {
      this.logger.warn(`Settlement token validation failed: token=${token} expired at=${session.expiresAt.toISOString()}`);
      throw new UnauthorizedException({
        statusCode: 401,
        message: 'Token has expired',
        error: 'TOKEN_EXPIRED',
      });
    }

    if (session.isUsed) {
      this.logger.warn(`Settlement token validation failed: token=${token} already used`);
      throw new UnauthorizedException({
        statusCode: 401,
        message: 'Token has already been used',
        error: 'TOKEN_ALREADY_USED',
      });
    }

    this.logger.log(`Settlement token validated successfully: sessionId=${session.id}`);
    return session;
  }

  /**
   * Helper: Validate settlement data
   */
  private async validateSettlementData(data: InitiateSettlementDto) {
    const errors: Array<{ field: string; message: string }> = [];

    if (data.totalAmount <= 0) {
      errors.push({
        field: 'totalAmount',
        message: 'Total amount must be greater than 0',
      });
    }

    if (!data.currency) {
      errors.push({
        field: 'currency',
        message: 'Currency is required',
      });
    } else if (!this.SUPPORTED_CURRENCIES.includes(data.currency.toUpperCase())) {
      errors.push({
        field: 'currency',
        message: 'Currency is not supported',
      });
    }

    if (!data.settlementMethod) {
      errors.push({
        field: 'settlementMethod',
        message: 'Settlement method is required',
      });
    }

    if (!data.merchantTransactionReference) {
      errors.push({
        field: 'merchantTransactionReference',
        message: 'Merchant transaction reference is required',
      });
    }

    if (!data.paymentMethod) {
      errors.push({
        field: 'paymentMethod',
        message: 'Payment method is required',
      });
    } else {
      if (!data.paymentMethod.type) {
        errors.push({
          field: 'paymentMethod.type',
          message: 'Payment method type is required',
        });
      } else {
        const methodType = data.paymentMethod.type.toUpperCase();
        if (!['MPESA', 'CASH'].includes(methodType)) {
          errors.push({
            field: 'paymentMethod.type',
            message: 'Unsupported payment method',
          });
        }

        if (methodType === 'MPESA' && !data.paymentMethod.payerPhoneNumber) {
          errors.push({
            field: 'paymentMethod.payerPhoneNumber',
            message: 'Payer phone number is required for MPESA',
          });
        }
      }
    }

    if (!data.transactionDate || Number.isNaN(Date.parse(data.transactionDate))) {
      errors.push({
        field: 'transactionDate',
        message: 'Transaction date must be a valid ISO 8601 timestamp',
      });
    }

    if (!data.suppliers || data.suppliers.length === 0) {
      errors.push({
        field: 'suppliers',
        message: 'At least one supplier allocation is required',
      });
    }

    this.logger.log(`Starting settlement payload validation: totalAmount=${data.totalAmount}, supplierGroups=${data.suppliers?.length ?? 0}`);
    let computedTotal = 0;

    for (const [supplierIndex, supplier] of (data.suppliers ?? []).entries()) {
      if (!supplier.supplierMerchantId) {
        errors.push({
          field: `suppliers[${supplierIndex}].supplierMerchantId`,
          message: 'Supplier merchant ID is required for each supplier group',
        });
      }

      if (!supplier.items || supplier.items.length === 0) {
        errors.push({
          field: `suppliers[${supplierIndex}].items`,
          message: 'Each supplier must include at least one item',
        });
        continue;
      }

      let supplierAmount = 0;
      let retailerAmount = 0;
      let platformFee = 0;

      for (const [itemIndex, item] of supplier.items.entries()) {
        if (!item.itemId) {
          errors.push({
            field: `suppliers[${supplierIndex}].items[${itemIndex}].itemId`,
            message: 'Item ID is required for each supplier item',
          });
        }

        if (item.supplierAmount <= 0) {
          errors.push({
            field: `suppliers[${supplierIndex}].items[${itemIndex}].supplierAmount`,
            message: 'Supplier amount must be greater than 0',
          });
        }

        if (item.retailerAmount && item.retailerAmount < 0) {
          errors.push({
            field: `suppliers[${supplierIndex}].items[${itemIndex}].retailerAmount`,
            message: 'Retailer amount cannot be negative',
          });
        }

        if (item.platformFee && item.platformFee < 0) {
          errors.push({
            field: `suppliers[${supplierIndex}].items[${itemIndex}].platformFee`,
            message: 'Platform fee cannot be negative',
          });
        }

        supplierAmount += item.supplierAmount;
        retailerAmount += item.retailerAmount ?? 0;
        platformFee += item.platformFee ?? 0;
      }

      if (supplier.supplierTotalAmount !== undefined && !this.areAmountsEqual(supplier.supplierTotalAmount, supplierAmount)) {
        errors.push({
          field: `suppliers[${supplierIndex}].supplierTotalAmount`,
          message: `Supplier total amount ${supplier.supplierTotalAmount} does not match sum of item supplier amounts ${supplierAmount}`,
        });
      }

      if (supplier.retailerTotalAmount !== undefined && !this.areAmountsEqual(supplier.retailerTotalAmount, retailerAmount)) {
        errors.push({
          field: `suppliers[${supplierIndex}].retailerTotalAmount`,
          message: `Retailer total amount ${supplier.retailerTotalAmount} does not match sum of item retailer amounts ${retailerAmount}`,
        });
      }

      if (supplier.platformFee !== undefined && !this.areAmountsEqual(supplier.platformFee, platformFee)) {
        errors.push({
          field: `suppliers[${supplierIndex}].platformFee`,
          message: `Platform fee ${supplier.platformFee} does not match sum of item platform fees ${platformFee}`,
        });
      }

      computedTotal += supplierAmount + retailerAmount + platformFee;

      const supplierIntegration = await this.prisma.integration.findFirst({
        where: {
          merchantId: supplier.supplierMerchantId,
          isActive: true,
        },
        include: {
          participant: true,
        },
      });

      if (!supplierIntegration?.participant) {
        this.logger.warn(`Supplier lookup failed during validation: supplierMerchantId=${supplier.supplierMerchantId}`);
        errors.push({
          field: `suppliers[${supplierIndex}].supplierMerchantId`,
          message: 'Supplier was not found in PayAssure',
        });
      } else {
        this.logger.log(`Supplier found during validation: supplierMerchantId=${supplier.supplierMerchantId}, status=${supplierIntegration.participant.status}`);
        const supplierStatus = supplierIntegration.participant.status as ParticipantStatus;
        const isActiveSupplier =
          supplierIntegration.participant.participantType === ParticipantType.SUPPLIER &&
          ([ParticipantStatus.ACTIVE, ParticipantStatus.LIVE] as ParticipantStatus[]).includes(
            supplierStatus,
          );

        if (!isActiveSupplier) {
          this.logger.warn(`Supplier not eligible during validation: supplierMerchantId=${supplier.supplierMerchantId}, status=${supplierStatus}`);
          errors.push({
            field: `suppliers[${supplierIndex}].supplierMerchantId`,
            message: 'Supplier is not active or not eligible to receive settlements',
          });
        }

        const supplierPayment = supplierIntegration.participant.payment as any;
        if (!supplierPayment) {
          this.logger.warn(`Supplier has no configured payment destination: supplierMerchantId=${supplier.supplierMerchantId}`);
          errors.push({
            field: `suppliers[${supplierIndex}].supplierMerchantId`,
            message: 'Supplier payout destination is not configured',
          });
        } else if (supplierPayment.isVerified !== true) {
          this.logger.warn(`Supplier payout destination not verified: supplierMerchantId=${supplier.supplierMerchantId}`);
          errors.push({
            field: `suppliers[${supplierIndex}].supplierMerchantId`,
            message: 'Supplier payout destination must be verified before settlement',
          });
        }
      }
    }

    if (!this.areAmountsEqual(data.totalAmount, computedTotal)) {
      errors.push({
        field: 'totalAmount',
        message: `Total amount ${data.totalAmount} does not match sum of supplier allocations ${computedTotal}`,
      });
    }

    this.logger.log(`Settlement payload validation completed: computedTotal=${computedTotal}, errors=${errors.length}`);

    if (errors.length > 0) {
      throw new BadRequestException({
        statusCode: 400,
        message: 'Validation failed',
        error: 'VALIDATION_ERROR',
        errors,
      });
    }
  }

  private areAmountsEqual(a: number, b: number): boolean {
    return Math.abs(a - b) < 0.01;
  }

  /**
   * Helper: Generate secure reusable session token
   */
  private generateSessionToken(): string {
    return `session_${Date.now()}_${crypto.randomBytes(16).toString('hex')}`;
  }

  /**
   * Helper: Hash credential (API key or secret)
   */
  private hashCredential(credential: string): string {
    return crypto.createHash('sha256').update(credential).digest('hex');
  }

  private generatePayAssureReference(): string {
    const timestamp = new Date().toISOString().replace(/[-:.TZ]/g, '').slice(0, 14);
    const randomSuffix = crypto.randomBytes(4).toString('hex').toUpperCase();
    return `PASTL-${timestamp}-${randomSuffix}`;
  }

  private generateInternalMerchantTransactionReference(): string {
    const timestamp = new Date().toISOString().replace(/[-:.TZ]/g, '').slice(0, 14);
    const randomSuffix = crypto.randomBytes(6).toString('hex').toUpperCase();
    return `MTXN-${timestamp}-${randomSuffix}`;
  }

  async onModuleDestroy() {
    await this.prisma.$disconnect();
  }
}
