import { BadRequestException, ForbiddenException, Injectable, Logger, NotFoundException, UnauthorizedException } from '@nestjs/common';
import { ParticipantStatus, ParticipantType, PrismaClient, SettlementStatus } from '@prisma/client';
import { request as httpsRequest } from 'https';
import { request as httpRequest } from 'http';
import { SettlementRepository } from './settlement.repository';
import { AuthenticateDto } from './dto/authenticate.dto';
import { InitiateSettlementDto } from './dto/initiate-settlement.dto';
import { ReconcileSettlementDto } from './dto/reconcile-settlement.dto';
import PaymentCallbackDto from './dto/payment-callback.dto';
import PaymentConfirmationDto from './dto/payment-confirmation.dto';
import {
  AuthenticateResponseDto,
  SettlementResponseDto,
  TrackSettlementResponseDto,
  ReconcileResponseDto,
} from './dto/settlement-response.dto';
import { authenticateOperation } from './operations/authenticate.operation';
import { initiateOperation } from './operations/initiate.operation';
import { trackOperation } from './operations/track.operation';
import { getTransactionOperation } from './operations/get-transaction.operation';
import { reconcileOperation } from './operations/reconcile.operation';
import { generateSessionToken, hashCredential } from './helpers/reference.helpers';
import { b2bService } from '../payment/services/b2b.service';
import { b2cService } from '../payment/services/b2c.service';
import { B2BPayoutIdempotencyService } from './services/b2b-payout-idempotency.service';
import { B2BPayoutRetryService } from './services/b2b-payout-retry.service';

interface B2bPayoutRecipient {
  type: string;
  provider?: string | null;
  shortcode?: string | null;
  accountName?: string | null;
  phoneNumber?: string | null;
  payerPhoneNumber?: string | null;
}

interface B2bGatewayResponse {
  success: boolean;
  statusCode?: number;
  responseCode?: string;
  responseDescription?: string;
  response?: any;
  error?: string;
}

@Injectable()
export class SettlementService {
  private prisma: PrismaClient;
  private readonly logger = new Logger(SettlementService.name);
  private readonly TOKEN_EXPIRY = 3600; // 1 hour in seconds
  private readonly SUPPORTED_CURRENCIES = ['KES', 'USD', 'TZS'];

  constructor(
    private readonly repository: SettlementRepository,
    private readonly idempotencyService: B2BPayoutIdempotencyService,
    private readonly retryService: B2BPayoutRetryService
  ) {
    this.prisma = new PrismaClient();
  }

  /**
   * STEP 1: Authenticate Business with API Key & Secret
   * Validates credentials and generates one-time token
   */
  async authenticate(data: AuthenticateDto, user: any): Promise<AuthenticateResponseDto> {
    return authenticateOperation(this.prisma, this.repository, data, user, this.logger, this.TOKEN_EXPIRY);
  }

  async authenticateSupplier(data: AuthenticateDto, user: any): Promise<any> {
    const integration = await this.prisma.integration.findFirst({
      where: { apiKey: data.apiKey, isActive: true },
      include: { participant: true },
    });

    if (!integration) {
      throw new NotFoundException({ statusCode: 404, message: 'Supplier not found with provided API key', error: 'SUPPLIER_NOT_FOUND' });
    }

    if (user && integration.participant && integration.participant.email) {
      const tokenEmail = user.email || '';
      if (tokenEmail !== integration.participant.email) {
        throw new UnauthorizedException({ statusCode: 401, message: 'Authenticated token does not belong to the owner of the provided API credentials', error: 'INVALID_TOKEN_FOR_API_KEYS' });
      }
    }

    const apiSecretHash = hashCredential(data.apiSecret);
    if (apiSecretHash !== integration.apiSecretHash) {
      throw new UnauthorizedException({ statusCode: 401, message: 'Invalid supplier credentials', error: 'INVALID_CREDENTIALS' });
    }

    if (integration.participant.participantType !== ParticipantType.SUPPLIER) {
      throw new ForbiddenException({ statusCode: 403, message: 'Business account is not a supplier', error: 'NOT_A_SUPPLIER' });
    }

    if (integration.participant.status !== ParticipantStatus.ACTIVE) {
      throw new ForbiddenException({ statusCode: 403, message: 'Supplier account is not active', error: 'SUPPLIER_NOT_ACTIVE' });
    }

    const sessionToken = generateSessionToken();
    const expiresAt = new Date(Date.now() + this.TOKEN_EXPIRY * 1000);
    await this.repository.createSettlementSession(integration.participantId, integration.id, sessionToken, expiresAt);

    return {
      success: true,
      sessionToken,
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

  async getSupplierSettlements(sessionToken: string): Promise<any> {
    const session = await this.repository.findSettlementSessionByToken(sessionToken);
    if (!session) {
      throw new UnauthorizedException({ statusCode: 401, message: 'Invalid supplier session token', error: 'INVALID_SUPPLIER_SESSION' });
    }

    if (session.expiresAt < new Date()) {
      throw new UnauthorizedException({ statusCode: 401, message: 'Supplier session has expired', error: 'SUPPLIER_SESSION_EXPIRED' });
    }

    const integration = await this.repository.findIntegrationById(session.integrationId);
    if (!integration || !integration.participant) {
      throw new UnauthorizedException({ statusCode: 401, message: 'Invalid supplier session context', error: 'INVALID_SUPPLIER_SESSION' });
    }

    if (integration.participant.participantType !== ParticipantType.SUPPLIER) {
      throw new ForbiddenException({ statusCode: 403, message: 'Session does not belong to a supplier', error: 'NOT_A_SUPPLIER_SESSION' });
    }

    await this.repository.touchSession(session.id);
    const settlements = await this.repository.findSettlementsBySupplierMerchantId(integration.merchantId);

    return {
      success: true,
      count: settlements.length,
      data: settlements.map((settlement: any) => {
        const payloadSuppliers = Array.isArray(settlement.paymentPayload?.suppliers) ? settlement.paymentPayload.suppliers : [];
        const firstSupplier = payloadSuppliers[0];
        const firstItem = Array.isArray(firstSupplier?.items) ? firstSupplier.items[0] : null;
        const itemReference = firstItem?.itemReference ?? firstItem?.itemId ?? null;

        return {
          reference: settlement.reference,
          merchantTransactionReference: settlement.merchantTransactionReference,
          amount: Number(settlement.amount),
          status: settlement.status,
          retailerMerchantId: settlement.metadata?.retailerMerchantId ?? null,
          itemReference,
        };
      }),
    };
  }

  /**
   * STEP 2: Initiate Settlement with One-Time Token
   * Validates token, creates settlement, and marks token as used
   */
  async initiateSettlement(token: string, data: InitiateSettlementDto): Promise<SettlementResponseDto> {
    return initiateOperation(this.prisma, this.repository, this.logger, token, data, this.SUPPORTED_CURRENCIES);
  }

  async handlePaymentCallback(data: PaymentCallbackDto): Promise<any> {
    const settlement = await this.repository.findSettlementByReference(data.merchantTransactionReference);

    if (!settlement) {
      throw new NotFoundException({ statusCode: 404, message: 'Settlement not found for the provided merchant transaction reference', error: 'SETTLEMENT_NOT_FOUND' });
    }

    const paymentCallback = {
      merchantTransactionReference: data.merchantTransactionReference,
      status: data.status ?? 'SUCCESS',
      provider: data.provider ?? null,
      providerReference: data.providerReference ?? null,
      amount: data.amount ?? null,
      currency: data.currency ?? null,
      metadata: data.metadata ?? {},
      receivedAt: new Date().toISOString(),
    };

    const existingMetadata = (settlement.metadata && typeof settlement.metadata === 'object') ? settlement.metadata as Record<string, any> : {};

    const paymentPayloadForAllocation = (settlement.paymentPayload && typeof settlement.paymentPayload === 'object' && !Array.isArray(settlement.paymentPayload))
      ? settlement.paymentPayload as Record<string, any>
      : {};
    const supplierGroups = new Map<string, number>();
    let retailerAmount = 0;
    let platformFee = 0;
    for (const supplier of (Array.isArray(paymentPayloadForAllocation.suppliers) ? paymentPayloadForAllocation.suppliers : [])) {
      const supplierId = String(supplier.supplierMerchantId ?? '').trim();
      const supplierAmount = Number(supplier.supplierTotalAmount ?? 0);
      if (supplierId) supplierGroups.set(supplierId, (supplierGroups.get(supplierId) ?? 0) + supplierAmount);
      retailerAmount += Number(supplier.retailerTotalAmount ?? 0);
      platformFee += Number(supplier.platformFee ?? 0);
    }
    const supplierAllocations = Array.from(supplierGroups, ([merchantId, amount]) => ({ merchantId, amount }));
    const supplierAmount = supplierAllocations.reduce((total, supplier) => total + supplier.amount, 0);

    const paymentMethod = (settlement.paymentPayload && typeof settlement.paymentPayload === 'object' && !Array.isArray(settlement.paymentPayload)
      ? (settlement.paymentPayload as Record<string, any>).paymentMethod
      : null) as Record<string, any> | null;

    const metadata = (settlement?.metadata && typeof settlement.metadata === 'object' && !Array.isArray(settlement.metadata))
      ? (settlement.metadata as Record<string, any>)
      : {};
    const paymentPayload = (settlement?.paymentPayload && typeof settlement.paymentPayload === 'object' && !Array.isArray(settlement.paymentPayload))
      ? (settlement.paymentPayload as Record<string, any>)
      : {};

    const supplierMerchantId = supplierAllocations[0]?.merchantId ?? this.resolveSupplierMerchantId(settlement, 'SUPPLIER');
    const retailerMerchantId = await this.resolveRetailerMerchantId(settlement);

    const supplierRecipient = supplierMerchantId ? await this.resolveB2bRecipient(settlement, 'SUPPLIER', supplierMerchantId) : null;
    const retailerRecipient = retailerMerchantId ? await this.resolveB2bRecipient(settlement, 'RETAILER', retailerMerchantId) : null;

    const allocationPlan = {
      customerReceived: Number(settlement.amount),
      ledgerEntries: [
        {
          account: 'Cash',
          direction: 'DEBIT',
          amount: Number(settlement.amount),
          description: 'Customer payment received',
        },
        {
          account: 'Customer Clearing',
          direction: 'CREDIT',
          amount: Number(settlement.amount),
          description: 'Customer funds parked pending allocation',
        },
      ],
      allocations: [
        {
          party: 'Supplier',
          amount: supplierAmount,
          destination: 'B2B payout',
          status: 'PENDING',
        },
        {
          party: 'Retailer',
          amount: retailerAmount,
          destination: 'B2B payout',
          status: 'PENDING',
        },
        {
          party: 'Platform',
          amount: platformFee,
          destination: 'Retained fee',
          status: 'PENDING',
        },
      ],
      paymentDetails: {
        supplier: {
          type: supplierRecipient?.type ?? paymentMethod?.type ?? 'MPESA',
          provider: supplierRecipient?.provider ?? paymentMethod?.provider ?? 'Safaricom',
          shortcode: supplierRecipient?.shortcode ?? null,
          accountName: supplierRecipient?.accountName ?? null,
          phoneNumber: supplierRecipient?.phoneNumber ?? supplierRecipient?.payerPhoneNumber ?? null,
          payerPhoneNumber: supplierRecipient?.payerPhoneNumber ?? supplierRecipient?.phoneNumber ?? null,
        },
        retailer: {
          type: retailerRecipient?.type ?? paymentMethod?.type ?? 'MPESA',
          provider: retailerRecipient?.provider ?? paymentMethod?.provider ?? 'Safaricom',
          shortcode: retailerRecipient?.shortcode ?? null,
          accountName: retailerRecipient?.accountName ?? null,
          phoneNumber: retailerRecipient?.phoneNumber ?? retailerRecipient?.payerPhoneNumber ?? null,
          payerPhoneNumber: retailerRecipient?.payerPhoneNumber ?? retailerRecipient?.phoneNumber ?? null,
        },
      },
    };

    await this.repository.updateSettlementStatus(settlement.id, 'PENDING_PROCESSING', {
      metadata: {
        ...existingMetadata,
        paymentCallback,
        paymentConfirmation: {
          ...paymentCallback,
          status: 'PAID',
          confirmedAt: new Date().toISOString(),
        },
        allocationPlan,
      },
    });

    return {
      success: true,
      status: 'PENDING_PROCESSING',
      message: 'Payment callback received. The settlement is now moving into ledger allocation and payout processing.',
      settlementId: settlement.id,
      nextStep: 'Create ledger entries and split the customer funds into supplier, retailer, and platform allocations.',
      allocationPlan,
    };
  }

  private async getB2bGatewayBaseUrl(): Promise<string | null> {
    const baseUrl = process.env.B2B_GATEWAY_BASE_URL || process.env.GATEWAY_BASE_URL;
    return baseUrl ? baseUrl.replace(/\/+$/, '') : null;
  }

  private getB2bPayoutCallbackUrl(callbackIdentifier?: string): string | null {
    const callbackBase = process.env.B2B_PAYOUT_CALLBACK_URL || process.env.PAYMENT_GATEWAY_CALLBACK_URL || process.env.MPESA_CALLBACK_URL;
    if (!callbackBase) {
      return null;
    }

    const normalizedBase = callbackBase.replace(/\/+$/, '');
    const baseWithoutPayments = normalizedBase.replace(/\/payments?$/, '');
    const callbackPath = '/settlement/payouts/callback';
    const callbackSuffix = callbackIdentifier ? `${callbackPath}/${callbackIdentifier}` : callbackPath;
    const callbackUrl = `${baseWithoutPayments}${callbackSuffix}`;

    return normalizedBase.endsWith(callbackSuffix) ? normalizedBase : callbackUrl;
  }

  private getB2bGatewayApiToken(): string | null {
    return process.env.B2B_GATEWAY_API_TOKEN || process.env.PAYMENT_GATEWAY_API_TOKEN || process.env.SETTLEMENT_API_TOKEN || null;
  }

  private async resolvePayoutValidationSettlement(settlement: any): Promise<any> {
    if (!settlement) {
      return settlement;
    }

    const metadata = (settlement.metadata && typeof settlement.metadata === 'object') ? settlement.metadata as Record<string, any> : {};
    if (this.hasConfirmedCustomerPayment(settlement, metadata)) {
      return settlement;
    }

    const parentSettlementId = metadata.parentSettlementId ?? null;
    if (parentSettlementId && typeof this.repository.findSettlementById === 'function') {
      const parentSettlement = await this.repository.findSettlementById(String(parentSettlementId));
      if (parentSettlement && parentSettlement.id !== settlement.id) {
        const parentMetadata = (parentSettlement.metadata && typeof parentSettlement.metadata === 'object') ? parentSettlement.metadata as Record<string, any> : {};
        if (this.hasConfirmedCustomerPayment(parentSettlement, parentMetadata)) {
          return parentSettlement;
        }
      }
    }

    const originalReference = metadata.originalMerchantReference ?? metadata.parentMerchantTransactionReference ?? null;
    if (originalReference && typeof this.repository.findSettlementByReference === 'function') {
      const originalSettlement = await this.repository.findSettlementByReference(String(originalReference));
      if (originalSettlement && originalSettlement.id !== settlement.id) {
        const originalMetadata = (originalSettlement.metadata && typeof originalSettlement.metadata === 'object') ? originalSettlement.metadata as Record<string, any> : {};
        if (this.hasConfirmedCustomerPayment(originalSettlement, originalMetadata)) {
          return originalSettlement;
        }
      }
    }

    return settlement;
  }

  private resolvePayoutGateway(recipientType?: string): 'B2C' | 'B2B' {
    const normalizedType = String(recipientType ?? '').trim().toUpperCase();
    return normalizedType === 'MPESA' ? 'B2C' : 'B2B';
  }

  private async sendB2bGatewayPayoutRequest(payload: Record<string, any>): Promise<B2bGatewayResponse> {
    const payoutMetadata = (payload.metadata && typeof payload.metadata === 'object' && !Array.isArray(payload.metadata)) ? payload.metadata as Record<string, any> : {};
    const payoutPayment = (payoutMetadata.payment && typeof payoutMetadata.payment === 'object' && !Array.isArray(payoutMetadata.payment))
      ? payoutMetadata.payment as Record<string, any>
      : ((payload.payment && typeof payload.payment === 'object' && !Array.isArray(payload.payment)) ? payload.payment as Record<string, any> : {});
    const recipientPhoneNumber = payload.recipientPhoneNumber ?? payoutPayment.phoneNumber ?? payoutPayment.payerPhoneNumber ?? null;
    const recipientType = String(payload.recipientType ?? payoutPayment.type ?? (recipientPhoneNumber ? 'MPESA' : 'BANK')).trim().toUpperCase();
    const resolvedRecipientType = recipientType === 'MPESA' || recipientType === 'BANK' ? recipientType : (recipientPhoneNumber ? 'MPESA' : 'BANK');
    try {
      if (resolvedRecipientType === 'MPESA') {
        const partyB = payload.recipientPhoneNumber ?? payload.phoneNumber ?? payload.payerPhoneNumber ?? payload.metadata?.payment?.phoneNumber ?? payload.metadata?.payment?.payerPhoneNumber ?? payload.recipientShortCode ?? '';
        const request = {
          OriginatorConversationID: payload.reference ?? payload.merchantTransactionReference ?? `${Date.now()}_b2c_${Math.random().toString(36).slice(2, 10)}`,
          CommandID: 'BusinessPayment',
          Amount: String(Number(payload.amount ?? 0)),
          PartyB: partyB,
          Remarks: payload.remarks ?? payload.description ?? `B2C payout to ${payload.party ?? 'recipient'}`,
          QueueTimeOutURL: payload.callbackUrl ?? process.env.MPESA_CALLBACK_URL ?? process.env.B2B_PAYOUT_CALLBACK_URL ?? process.env.PAYMENT_GATEWAY_CALLBACK_URL,
          ResultURL: payload.callbackUrl ?? process.env.MPESA_CALLBACK_URL ?? process.env.B2B_PAYOUT_CALLBACK_URL ?? process.env.PAYMENT_GATEWAY_CALLBACK_URL,
          Occassion: payload.description ?? payload.remarks ?? `B2C payout to ${payload.party ?? 'recipient'}`,
        };

        const response = await b2cService.initiateB2C(request as Record<string, any>);
        const responseCode = response?.responseCode ?? response?.ResponseCode ?? 'UNKNOWN';
        const responseDescription = response?.responseDescription ?? response?.ResponseDescription ?? 'Unknown B2C gateway response';
        const isAcceptedBySafaricom = String(responseCode) === '0';

        return {
          success: isAcceptedBySafaricom,
          statusCode: 200,
          responseCode: String(responseCode),
          responseDescription: String(responseDescription),
          response,
        };
      }

      const response = await b2bService.initiateB2B({
        recipientShortCode: payload.recipientShortCode ?? payload.recipientPhoneNumber ?? payload.accountReference ?? '174379',
        amount: Number(payload.amount ?? 0),
        description: payload.description ?? payload.remarks ?? 'Settlement payout',
        accountReference: payload.accountReference ?? payload.metadata?.supplierMerchantId ?? 'B2B Payment',
        callbackUrl: payload.callbackUrl ?? process.env.MPESA_CALLBACK_URL ?? process.env.B2B_PAYOUT_CALLBACK_URL ?? process.env.PAYMENT_GATEWAY_CALLBACK_URL,
      });

      const responseCode = response?.responseCode ?? response?.ResponseCode ?? 'UNKNOWN';
      const responseDescription = response?.responseDescription ?? response?.ResponseDescription ?? 'Unknown B2B gateway response';
      const isAcceptedBySafaricom = String(responseCode) === '0';

      return {
        success: isAcceptedBySafaricom,
        statusCode: 200,
        responseCode: String(responseCode),
        responseDescription: String(responseDescription),
        response,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const errorStack = error instanceof Error ? error.stack : undefined;

      this.logger.error('[B2B][DISPATCH] external payment gateway request failed', {
        recipientType,
        selectedGateway: this.resolvePayoutGateway(resolvedRecipientType),
        error: message,
        errorStack,
        payloadSummary: {
          amount: payload.amount,
          recipientShortCode: payload.recipientShortCode ?? payload.recipientPhoneNumber,
          accountReference: payload.accountReference,
          callbackUrl: payload.callbackUrl,
        },
        timestamp: new Date().toISOString(),
        troubleshooting: {
          checkMpesaEnvironment: process.env.MPESA_ENVIRONMENT || 'not set (defaults to sandbox)',
          checkInitiatorName: process.env.MPESA_INITIATOR_NAME || 'not set (defaults to testapi)',
          checkConsumerKeySet: !!process.env.MPESA_CONSUMER_KEY,
          checkConsumerSecretSet: !!process.env.MPESA_CONSUMER_SECRET,
        },
      });

      return { success: false, error: message };
    }
  }

  private hasConfirmedCustomerPayment(settlement: any, metadata: Record<string, any>): boolean {
    const settlementStatus = String(settlement?.status ?? '').toUpperCase();
    const callbackStatus = String(metadata?.paymentCallback?.status ?? metadata?.paymentConfirmation?.status ?? '').toUpperCase();
    const confirmationStatus = String(metadata?.paymentConfirmation?.status ?? '').toUpperCase();
    const splitStatus = Array.isArray(metadata?.splitRecords)
      ? metadata.splitRecords.some((record: any) => {
          const sameReference = record?.merchantTransactionReference === settlement?.merchantTransactionReference;
          const successStatus = ['SUCCESS', 'PAID', 'COMPLETED'].includes(String(record?.status ?? '').toUpperCase());
          return sameReference && successStatus;
        })
      : false;

    const processingState = ['PENDING_PROCESSING', 'PROCESSING', 'PROCESSING_COMPLETE', 'AWAITING_RECONCILIATION', 'COMPLETED'].includes(settlementStatus);
    const callbackConfirmed = ['SUCCESS', 'PAID', 'COMPLETED'].includes(callbackStatus);
    const confirmationConfirmed = ['SUCCESS', 'PAID', 'COMPLETED'].includes(confirmationStatus);

    return callbackConfirmed || confirmationConfirmed || splitStatus || processingState;
  }

  private resolveSupplierMerchantId(settlement: any, party: 'SUPPLIER' | 'RETAILER', supplierMerchantId?: string): string | null {
    if (supplierMerchantId) {
      return String(supplierMerchantId);
    }

    const metadataSupplierMerchantId = settlement?.metadata?.supplierMerchantId ?? null;
    if (metadataSupplierMerchantId) {
      return String(metadataSupplierMerchantId);
    }

    const paymentPayloadSuppliers = Array.isArray(settlement?.paymentPayload?.suppliers)
      ? settlement.paymentPayload.suppliers.filter((supplier: any) => supplier && typeof supplier === 'object')
      : [];

    if (paymentPayloadSuppliers.length === 0) {
      return null;
    }

    const firstSupplier = paymentPayloadSuppliers[0] as Record<string, any> | undefined;
    const fallbackSupplierMerchantId = firstSupplier?.supplierMerchantId ?? null;
    return fallbackSupplierMerchantId ? String(fallbackSupplierMerchantId) : null;
  }

  private async resolveRetailerMerchantId(settlement: any): Promise<string | null> {
    const participantId = settlement?.businessId ?? null;
    if (participantId && typeof this.repository?.findIntegrationByParticipantId === 'function') {
      const activeRetailerIntegration = await this.repository.findIntegrationByParticipantId(String(participantId));
      if (activeRetailerIntegration?.merchantId) {
        return String(activeRetailerIntegration.merchantId);
      }
    }

    const metadataRetailerMerchantId = settlement?.metadata?.retailerMerchantId ?? null;
    if (metadataRetailerMerchantId) {
      return String(metadataRetailerMerchantId);
    }

    const paymentPayloadMerchantId = settlement?.paymentPayload?.merchantId ?? null;
    return paymentPayloadMerchantId ? String(paymentPayloadMerchantId) : null;
  }

  private async resolveB2bRecipient(settlement: any, party: 'SUPPLIER' | 'RETAILER', supplierMerchantId?: string): Promise<B2bPayoutRecipient> {
    if (party === 'RETAILER') {
      const retailerMerchantId = await this.resolveRetailerMerchantId(settlement);

      if (retailerMerchantId) {
        const retailerIntegration = await this.repository.findIntegrationByMerchantId(String(retailerMerchantId));
        if (retailerIntegration?.participant?.payment) {
          const payment = retailerIntegration.participant.payment as any;
          return {
            type: payment.type,
            provider: payment.provider ?? null,
            shortcode: payment.shortcode ?? null,
            accountName: payment.accountName ?? null,
            phoneNumber: payment.phoneNumber ?? payment.payerPhoneNumber ?? null,
            payerPhoneNumber: payment.payerPhoneNumber ?? payment.phoneNumber ?? null,
          };
        }
      }

      const participant = await this.prisma.onboardingParticipant.findUnique({ where: { id: settlement.businessId } });
      if (!participant) {
        throw new NotFoundException({ statusCode: 404, message: 'Retailer participant not found for this settlement', error: 'RETAILER_NOT_FOUND' });
      }
      const payment = (participant.payment ?? null) as any;
      if (!payment) {
        throw new BadRequestException({ statusCode: 400, message: 'Retailer payout destination is not configured', error: 'RETAILER_PAYMENT_NOT_CONFIGURED' });
      }
      return {
        type: payment.type,
        provider: payment.provider ?? null,
        shortcode: payment.shortcode ?? null,
        accountName: payment.accountName ?? null,
        phoneNumber: payment.phoneNumber ?? payment.payerPhoneNumber ?? null,
        payerPhoneNumber: payment.payerPhoneNumber ?? payment.phoneNumber ?? null,
      };
    }

    const supplierId = this.resolveSupplierMerchantId(settlement, party, supplierMerchantId);
    if (!supplierId) {
      throw new BadRequestException({ statusCode: 400, message: 'Supplier merchant ID is required for supplier payouts', error: 'SUPPLIER_MERCHANT_ID_REQUIRED' });
    }

    const payment = (settlement.paymentSnapshot ?? null) as any;
    if (payment && payment.type) {
      return {
        type: payment.type,
        provider: payment.provider ?? null,
        shortcode: payment.shortcode ?? null,
        accountName: payment.accountName ?? null,
        phoneNumber: payment.phoneNumber ?? payment.payerPhoneNumber ?? null,
        payerPhoneNumber: payment.payerPhoneNumber ?? payment.phoneNumber ?? null,
      };
    }

    const supplierIntegration = await this.repository.findIntegrationByMerchantId(supplierId);
    if (!supplierIntegration?.participant) {
      throw new NotFoundException({ statusCode: 404, message: 'Supplier integration or payout destination not found', error: 'SUPPLIER_PAYMENT_NOT_FOUND' });
    }

    const supplierPayment = (supplierIntegration.participant.payment ?? null) as any;
    if (!supplierPayment) {
      throw new BadRequestException({ statusCode: 400, message: 'Supplier payout destination is not configured', error: 'SUPPLIER_PAYMENT_NOT_CONFIGURED' });
    }

    return {
      type: supplierPayment.type,
      provider: supplierPayment.provider ?? null,
      shortcode: supplierPayment.shortcode ?? null,
      accountName: supplierPayment.accountName ?? null,
      phoneNumber: supplierPayment.phoneNumber ?? supplierPayment.payerPhoneNumber ?? null,
      payerPhoneNumber: supplierPayment.payerPhoneNumber ?? supplierPayment.phoneNumber ?? null,
    };
  }

  async dispatchB2bPayouts(data: any): Promise<any> {
    const settlement = await this.repository.findSettlementByReference(data.merchantTransactionReference);
    if (!settlement) {
      throw new NotFoundException({ statusCode: 404, message: 'Settlement not found for the provided merchant transaction reference', error: 'SETTLEMENT_NOT_FOUND' });
    }
    const existingMetadata = (settlement.metadata && typeof settlement.metadata === 'object') ? settlement.metadata as Record<string, any> : {};

    const validationSettlement = await this.resolvePayoutValidationSettlement(settlement);
    const validationMetadata = (validationSettlement?.metadata && typeof validationSettlement.metadata === 'object')
      ? validationSettlement.metadata as Record<string, any>
      : {};
    const settlementStatus = String((validationSettlement?.status ?? settlement?.status ?? '')).toUpperCase();
    const hasConfirmedCustomerPayment = this.hasConfirmedCustomerPayment(validationSettlement, validationMetadata);

    if (!hasConfirmedCustomerPayment) {
      this.logger.warn('[B2B][DISPATCH] payment confirmation gate failed', {
        settlementId: settlement.id,
        settlementLookupId: validationSettlement?.id ?? settlement.id,
        merchantTransactionReference: settlement.merchantTransactionReference,
        validationReference: validationSettlement?.merchantTransactionReference ?? null,
        settlementStatus,
        metadata: validationMetadata,
      });
      throw new NotFoundException({
        statusCode: 404,
        message: 'A successful payment callback or confirmation has not been recorded for this settlement',
        data: { existingMetadata, settlementStatus },
        error: 'PAYMENT_NOT_CONFIRMED',
      });
    }

    const workingSettlement = validationSettlement ?? settlement;
    const party = (String(data.party || (existingMetadata?.supplierMerchantId ? 'SUPPLIER' : 'RETAILER')).toUpperCase() as 'SUPPLIER' | 'RETAILER');
    const resolvedSupplierMerchantId = this.resolveSupplierMerchantId(workingSettlement, party, data.supplierMerchantId);
    const resolvedRetailerMerchantId = await this.resolveRetailerMerchantId(workingSettlement);
    const resolvedPartyMerchantId = party === 'RETAILER' ? resolvedRetailerMerchantId : resolvedSupplierMerchantId;
    const recipient = await this.resolveB2bRecipient(workingSettlement, party, resolvedSupplierMerchantId ?? undefined);

    if (recipient.type === 'BANK') {
      if (!recipient.shortcode || !recipient.accountName) {
        throw new BadRequestException({ statusCode: 400, message: 'Bank payouts require a recipient shortcode and accountName', error: 'BANK_PAYOUT_DETAILS_INCOMPLETE' });
      }
    }
    if (recipient.type === 'MPESA') {
      const recipientPhoneNumber = recipient.phoneNumber ?? recipient.payerPhoneNumber ?? null;
      if (!recipientPhoneNumber) {
        throw new BadRequestException({ statusCode: 400, message: 'MPESA payouts require a recipient phoneNumber', error: 'MPESA_PAYOUT_DETAILS_INCOMPLETE' });
      }
    }

    let amount = Number(data.amount ?? 0);
    if (amount <= 0) {
      const allocation = Array.isArray(existingMetadata.allocationPlan?.allocations)
        ? existingMetadata.allocationPlan.allocations.find((alloc: any) => alloc.party === party)
        : null;
      amount = Number(allocation?.amount ?? 0);
    }

    if (amount <= 0) {
      throw new BadRequestException({ statusCode: 400, message: 'Payout amount must be greater than zero', error: 'INVALID_PAYOUT_AMOUNT' });
    }

    const roundedAmount = amount > 0 && amount < 1 ? 1 : Math.round(amount);
    if (roundedAmount !== amount) {
    }

    // Check for existing payout attempt (idempotency)
    const payoutAttemptResult = await this.idempotencyService.createOrGetPayoutAttempt({
      settlementId: settlement.id,
      merchantTransactionReference: data.merchantTransactionReference,
      party,
      amount: roundedAmount,
      recipientMerchantId: resolvedPartyMerchantId ?? undefined,
      recipientType: recipient.type,
      recipientPhone: recipient.phoneNumber ?? recipient.payerPhoneNumber ?? undefined,
    });

    // If payout was already attempted and completed, don't retry
    if (!payoutAttemptResult.isNewAttempt && payoutAttemptResult.status === 'COMPLETED') {
      this.logger.warn('[PAYOUT] Payout already completed, skipping duplicate', {
        settlementId: settlement.id,
        payoutReference: payoutAttemptResult.payoutReference,
        party,
        attemptCount: payoutAttemptResult.attemptCount,
      });

      return {
        success: true,
        status: 'COMPLETED',
        payoutReference: payoutAttemptResult.payoutReference,
        isDuplicate: true,
        message: 'Payout already completed. Duplicate dispatch prevented.',
        dispatchRecord: {
          reference: payoutAttemptResult.payoutReference,
          party,
          status: 'COMPLETED',
          amount: roundedAmount,
          attemptCount: payoutAttemptResult.attemptCount,
        },
      };
    }

    const payoutReference = payoutAttemptResult.payoutReference;
    const callbackIdentifier = (globalThis as any)?.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(16).slice(2)}`;
    const callbackUrl = this.getB2bPayoutCallbackUrl(callbackIdentifier);
    const recipientPhoneNumber = recipient.phoneNumber ?? recipient.payerPhoneNumber ?? null;
    const recipientShortCode = recipient.shortcode ?? recipientPhoneNumber ?? null;
    const payoutPayment = {
      type: recipient.type,
      provider: recipient.provider ?? null,
      shortcode: recipient.shortcode ?? null,
      accountName: recipient.accountName ?? null,
      phoneNumber: recipientPhoneNumber,
      payerPhoneNumber: recipientPhoneNumber,
    };

    const requestPayload = {
      reference: payoutReference,
      merchantTransactionReference: workingSettlement.merchantTransactionReference,
      settlementReference: workingSettlement.reference,
      party,
      amount: roundedAmount,
      currency: workingSettlement.currency ?? 'KES',
      recipientShortCode,
      accountReference: recipient.accountName,
      remarks: `B2B payout to ${party}`,
      description: `Settlement payout for ${party}`,
      callbackUrl: callbackUrl ?? undefined,
      recipientType: recipient.type,
      recipientProvider: recipient.provider,
      recipientPhoneNumber: recipientPhoneNumber ?? undefined,
      metadata: {
        settlementId: settlement.id,
        party,
        callbackIdentifier,
        callbackToken: callbackIdentifier,
        callbackUrl: callbackUrl ?? null,
        supplierMerchantId: party === 'SUPPLIER' ? (resolvedSupplierMerchantId ?? null) : null,
        retailerMerchantId: party === 'RETAILER' ? (resolvedRetailerMerchantId ?? null) : null,
        merchantId: resolvedPartyMerchantId ?? null,
        payment: payoutPayment,
        ...((data.metadata ?? {}) as Record<string, any>),
      },
    };

    this.logger.log('[PAYOUT_DISPATCH_PAYLOAD]', {
      ...requestPayload,
      idempotencyKey: payoutAttemptResult.idempotencyKey,
      isNewAttempt: payoutAttemptResult.isNewAttempt,
      attemptCount: payoutAttemptResult.attemptCount,
    });

    let gatewayResult: B2bGatewayResponse;
    try {
      gatewayResult = await this.sendB2bGatewayPayoutRequest(requestPayload);

      // Update payout attempt status based on gateway response
      await this.idempotencyService.updatePayoutAttemptStatus(
        payoutAttemptResult.idempotencyKey,
        gatewayResult.success ? 'SUBMITTED' : 'FAILED',
        {
          responseCode: gatewayResult.responseCode,
          responseDescription: gatewayResult.responseDescription,
          response: gatewayResult.response,
        }
      );
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);

      // Schedule retry for failed payout
      if (payoutAttemptResult.isNewAttempt) {
        const retrySchedule = await this.retryService.scheduleFailedPayoutForRetry(
          payoutAttemptResult.idempotencyKey,
          errorMsg
        );

        this.logger.error('[PAYOUT] Payout dispatch failed, scheduled for retry', {
          payoutReference,
          settlementId: settlement.id,
          error: errorMsg,
          retrySchedule,
        });
      }

      // Re-throw error only if it's a critical issue
      throw error;
    }

    const payoutDispatches = Array.isArray(existingMetadata.payoutDispatches) ? existingMetadata.payoutDispatches : [];
    const payoutDispatchAuditLog = Array.isArray(existingMetadata.payoutDispatchAuditLog) ? existingMetadata.payoutDispatchAuditLog : [];
    const payoutStatus = gatewayResult.success ? 'SUBMITTED' : 'FAILED';
    const latestPayoutMetadata = {
      payoutReference,
      latestPayoutReference: payoutReference,
      lastPayoutParty: party,
      lastPayoutStatus: payoutStatus,
      lastPayoutRequestedAt: new Date().toISOString(),
    };
    const dispatchRecord = {
      reference: payoutReference,
      party,
      status: payoutStatus,
      amount,
      recipient,
      callbackIdentifier,
      callbackToken: callbackIdentifier,
      requestPayload,
      gatewayResult,
      requestedAt: new Date().toISOString(),
    };

    const auditEntry = {
      event: gatewayResult.success ? 'B2B_SUBMITTED' : 'B2B_SUBMIT_FAILED',
      payoutReference,
      party,
      settlementId: settlement.id,
      merchantTransactionReference: settlement.merchantTransactionReference,
      amount,
      recipientShortCode,
      accountReference: recipient.accountName,
      callbackUrl: callbackUrl ?? null,
      gatewayResultSummary: {
        success: gatewayResult.success,
        statusCode: gatewayResult.statusCode ?? null,
        responseCode: gatewayResult.responseCode ?? null,
        responseDescription: gatewayResult.responseDescription ?? null,
        error: gatewayResult.error ?? null,
      },
      payloadHash: Buffer.from(JSON.stringify(requestPayload)).toString('base64'),
      createdAt: new Date().toISOString(),
    };

    await this.repository.updateSettlementStatus(settlement.id, 'PROCESSING', {
      metadata: {
        ...existingMetadata,
        ...latestPayoutMetadata,
        payoutReference,
        latestPayoutReference: payoutReference,
        payoutDispatches: [...payoutDispatches, dispatchRecord],
        payoutDispatchAuditLog: [...payoutDispatchAuditLog, auditEntry],
      },
    });

    return {
      success: gatewayResult.success,
      status: dispatchRecord.status,
      payoutReference,
      gatewayResult,
      dispatchRecord,
    };
  }

  async handleB2bPayoutCallback(data: any, callbackIdentifier?: string): Promise<any> {
    // PRIMARY LOOKUP: Use callbackIdentifier from URL path (most reliable)
    let settlement = null;
    if (callbackIdentifier) {
      settlement = await this.repository.findSettlementByPayoutCallbackIdentifier(callbackIdentifier);
      if (settlement) {
      }
    }

    // FALLBACK: Try other reference fields from callback data
    if (!settlement) {
      const fallbackReferences = [
        data?.callbackIdentifier,
        data?.callbackToken,
        data?.merchantTransactionReference,
        data?.metadata?.merchantTransactionReference,
        data?.providerReference,
        data?.transactionId,
      ].filter(Boolean);

      for (const ref of fallbackReferences) {
        settlement = await this.repository.findSettlementByReference(ref);
        if (settlement) {
          break;
        }
      }
    }

    if (!settlement) {
      this.logger.error('[B2B][CALLBACK][LOOKUP] settlement not found', {
        callbackIdentifier,
        merchantTransactionReference: data?.merchantTransactionReference ?? null,
        reference: data?.reference ?? null,
        transactionId: data?.transactionId ?? null,
      });
      throw new NotFoundException({ statusCode: 404, message: 'Settlement not found for the provided B2B callback reference', error: 'SETTLEMENT_NOT_FOUND' });
    }

    const party = (String(data.party || 'SUPPLIER').toUpperCase() as 'SUPPLIER' | 'RETAILER');
    const payoutStatus = String(data.status || 'FAILED').toUpperCase();
    const isSuccess = payoutStatus === 'SUCCESS' || payoutStatus === 'PAID';
    const status = isSuccess ? 'PAID' : 'FAILED';

    // Update idempotency tracking if callback reference is available
    if (data.callbackIdentifier || data.callbackToken) {
      const callbackRef = data.callbackIdentifier ?? data.callbackToken;
      try {
        await this.idempotencyService.markCallbackReceived(callbackRef, data);
        this.logger.log('[B2B][CALLBACK] Marked callback as received in idempotency tracking', {
          callbackIdentifier: callbackRef,
          payoutStatus: status,
        });
      } catch (error) {
        this.logger.warn('[B2B][CALLBACK] Failed to update idempotency tracking', {
          callbackIdentifier: callbackRef,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    const existingMetadata = (settlement.metadata && typeof settlement.metadata === 'object') ? settlement.metadata as Record<string, any> : {};
    const currentAllocation = Array.isArray(existingMetadata.allocationPlan?.allocations)
      ? existingMetadata.allocationPlan.allocations.map((allocation: any) => {
          if (allocation.party === party) {
            return {
              ...allocation,
              status,
              paidAt: new Date().toISOString(),
              payoutReference: data.reference,
              payoutStatus: status,
            };
          }
          return allocation;
        })
      : [];

    const payoutCallback = {
      transactionId: data.transactionId,
      reference: data.reference,
      merchantTransactionReference: data.merchantTransactionReference,
      settlementReference: settlement.reference,
      party,
      supplierMerchantId: this.resolveSupplierMerchantId(settlement, party, data.supplierMerchantId) ?? null,
      status,
      providerReference: data.providerReference ?? null,
      amount: data.amount ?? null,
      metadata: data.metadata ?? {},
      processedAt: new Date().toISOString(),
    };

    const payoutCallbacks = Array.isArray(existingMetadata.payoutCallbacks) ? existingMetadata.payoutCallbacks : [];
    const updatedMetadata = {
      ...existingMetadata,
      payoutCallbacks: [...payoutCallbacks, payoutCallback],
      allocationPlan: existingMetadata.allocationPlan
        ? {
            ...existingMetadata.allocationPlan,
            allocations: currentAllocation,
          }
        : existingMetadata.allocationPlan,
      lastPayoutCallback: payoutCallback,
    };

    const nextStatus = isSuccess ? 'PROCESSING' : 'FAILED';
    await this.repository.updateSettlementStatus(settlement.id, nextStatus, {
      metadata: updatedMetadata,
    });


    return {
      success: true,
      status: nextStatus,
      settlementId: settlement.id,
      payoutCallback,
    };
  }

  async confirmSettlementPayment(data: PaymentConfirmationDto): Promise<any> {
    let settlement = await this.repository.findSettlementById(data.settlementId);

    if (!settlement) {
      const fallbackSettlement = await this.repository.findSettlementByReference?.(data.settlementId);
      settlement = fallbackSettlement ?? null;
    }

    if (!settlement) {
      this.logger.warn(`[CONFIRMATION][LOOKUP] failed: settlement ${data.settlementId} was not found`);
      throw new NotFoundException({ statusCode: 404, message: 'Settlement not found for the provided settlement identifier', error: 'SETTLEMENT_NOT_FOUND' });
    }


    if ((settlement.status as string) === 'PENDING_PROCESSING' || (settlement.status as string) === 'PROCESSING' || (settlement.status as string) === 'COMPLETED') {
      return {
        success: true,
        status: settlement.status,
        message: 'Payment confirmation was already processed for this settlement.',
        settlementId: settlement.id,
      };
    }

    if (data.status && data.status.toUpperCase() !== 'PAID') {
      this.logger.warn(`[CONFIRMATION][RESULT] unsupported status ${data.status} for settlement ${settlement.id}`);
      throw new BadRequestException({ statusCode: 400, message: 'Only PAID confirmations are accepted for settlement completion', error: 'INVALID_PAYMENT_STATUS' });
    }

    const paymentConfirmation = {
      paymentId: data.paymentId ?? null,
      settlementId: data.settlementId,
      status: data.status ?? 'PAID',
      provider: data.provider ?? null,
      paidAmount: data.paidAmount ?? Number(settlement.amount ?? 0),
      paidAt: data.paidAt ?? new Date().toISOString(),
      providerReference: data.providerReference ?? null,
      confirmedAt: new Date().toISOString(),
    };

    const existingMetadata = (settlement.metadata && typeof settlement.metadata === 'object') ? settlement.metadata as Record<string, any> : {};

    const allocationPayload = (settlement.paymentPayload && typeof settlement.paymentPayload === 'object' && !Array.isArray(settlement.paymentPayload))
      ? settlement.paymentPayload as Record<string, any>
      : {};
    const supplierGroups = new Map<string, number>();
    let retailerAmount = 0;
    let platformFee = 0;
    for (const supplier of (Array.isArray(allocationPayload.suppliers) ? allocationPayload.suppliers : [])) {
      const supplierId = String(supplier.supplierMerchantId ?? '').trim();
      if (supplierId) supplierGroups.set(supplierId, (supplierGroups.get(supplierId) ?? 0) + Number(supplier.supplierTotalAmount ?? 0));
      retailerAmount += Number(supplier.retailerTotalAmount ?? 0);
      platformFee += Number(supplier.platformFee ?? 0);
    }
    const supplierAllocations = Array.from(supplierGroups, ([merchantId, amount]) => ({ merchantId, amount }));
    const supplierAmount = supplierAllocations.reduce((total, supplier) => total + supplier.amount, 0);

    const paymentMethod = (settlement.paymentPayload && typeof settlement.paymentPayload === 'object' && !Array.isArray(settlement.paymentPayload)
      ? (settlement.paymentPayload as Record<string, any>).paymentMethod
      : null) as Record<string, any> | null;

    const metadata = (settlement?.metadata && typeof settlement.metadata === 'object' && !Array.isArray(settlement.metadata))
      ? (settlement.metadata as Record<string, any>)
      : {};
    const paymentPayload = (settlement?.paymentPayload && typeof settlement.paymentPayload === 'object' && !Array.isArray(settlement.paymentPayload))
      ? (settlement.paymentPayload as Record<string, any>)
      : {};

    const supplierMerchantId = supplierAllocations[0]?.merchantId ?? this.resolveSupplierMerchantId(settlement, 'SUPPLIER');
    const retailerMerchantId = await this.resolveRetailerMerchantId(settlement);

    const supplierRecipient = supplierMerchantId ? await this.resolveB2bRecipient(settlement, 'SUPPLIER', supplierMerchantId) : null;
    const retailerRecipient = retailerMerchantId ? await this.resolveB2bRecipient(settlement, 'RETAILER', retailerMerchantId) : null;

    const allocationPlan = {
      customerReceived: Number(settlement.amount),
      ledgerEntries: [
        {
          account: 'Cash',
          direction: 'DEBIT',
          amount: Number(settlement.amount),
          description: 'Customer payment received',
        },
        {
          account: 'Customer Clearing',
          direction: 'CREDIT',
          amount: Number(settlement.amount),
          description: 'Customer funds parked pending allocation',
        },
      ],
      allocations: [
        {
          party: 'Supplier',
          amount: supplierAmount,
          destination: 'B2B payout',
          status: 'PENDING',
        },
        {
          party: 'Retailer',
          amount: retailerAmount,
          destination: 'B2B payout',
          status: 'PENDING',
        },
        {
          party: 'Platform',
          amount: platformFee,
          destination: 'Retained fee',
          status: 'PENDING',
        },
      ],
      paymentDetails: {
        supplier: {
          type: supplierRecipient?.type ?? paymentMethod?.type ?? 'MPESA',
          provider: supplierRecipient?.provider ?? paymentMethod?.provider ?? 'Safaricom',
          shortcode: supplierRecipient?.shortcode ?? null,
          accountName: supplierRecipient?.accountName ?? null,
          phoneNumber: supplierRecipient?.phoneNumber ?? supplierRecipient?.payerPhoneNumber ?? null,
          payerPhoneNumber: supplierRecipient?.payerPhoneNumber ?? supplierRecipient?.phoneNumber ?? null,
        },
        retailer: {
          type: retailerRecipient?.type ?? paymentMethod?.type ?? 'MPESA',
          provider: retailerRecipient?.provider ?? paymentMethod?.provider ?? 'Safaricom',
          shortcode: retailerRecipient?.shortcode ?? null,
          accountName: retailerRecipient?.accountName ?? null,
          phoneNumber: retailerRecipient?.phoneNumber ?? retailerRecipient?.payerPhoneNumber ?? null,
          payerPhoneNumber: retailerRecipient?.payerPhoneNumber ?? retailerRecipient?.phoneNumber ?? null,
        },
      },
    };


    await this.repository.updateSettlementStatus(settlement.id, 'PENDING_PROCESSING', {
      metadata: {
        ...existingMetadata,
        paymentConfirmation,
        allocationPlan,
      },
    });


    const dispatchResults: Array<any> = [];
    try {
      for (const supplier of supplierAllocations) {
        try {
          const supplierDispatch = await this.dispatchB2bPayouts({
            merchantTransactionReference: settlement.merchantTransactionReference,
            party: 'SUPPLIER',
            amount: supplier.amount,
            supplierMerchantId: supplier.merchantId,
          });
          dispatchResults.push({ party: 'SUPPLIER', supplierMerchantId: supplier.merchantId, result: supplierDispatch });
        } catch (error) {
          this.logger.warn(`[CONFIRMATION][DISPATCH] supplier payout dispatch failed for settlement ${settlement.id}: ${error instanceof Error ? error.message : String(error)}`);
          dispatchResults.push({ party: 'SUPPLIER', supplierMerchantId: supplier.merchantId, error: error instanceof Error ? error.message : String(error) });
        }
      }
    } catch (error) {
      this.logger.error(`[CONFIRMATION][DISPATCH] supplier payout dispatch loop failed for settlement ${settlement.id}: ${error instanceof Error ? error.message : String(error)}`);
    }

    try {
      const retailerDispatch = await this.dispatchB2bPayouts({
        merchantTransactionReference: settlement.merchantTransactionReference,
        party: 'RETAILER',
        amount: retailerAmount,
      });
      dispatchResults.push({ party: 'RETAILER', result: retailerDispatch });
    } catch (error) {
      this.logger.warn(`[CONFIRMATION][DISPATCH] retailer payout dispatch failed for settlement ${settlement.id}: ${error instanceof Error ? error.message : String(error)}`);
      dispatchResults.push({ party: 'RETAILER', error: error instanceof Error ? error.message : String(error) });
    }

    return {
      success: true,
      status: 'PENDING_PROCESSING',
      message: 'Payment confirmation accepted. The settlement is now processing B2B payout dispatch.',
      settlementId: settlement.id,
      nextStep: 'Dispatch B2B payouts to supplier and retailer and wait for payout callbacks.',
      allocationPlan,
      dispatchResults,
    };
  }

  /**
   * STEP 3: Track Settlement Status
   * Retrieve current status and transaction details
   */
  async trackSettlement(settlementId: string, view: 'retailer' | 'supplier' | 'payassure' = 'retailer'): Promise<any> {
    return trackOperation(this.prisma, this.repository, settlementId, view);
  }

  /**
   * STEP 4: Get Transaction Details
   * Retrieve specific transaction information
   */
  async getTransaction(transactionId: string) {
    return getTransactionOperation(this.repository, transactionId);
  }

  /**
   * STEP 5: Reconcile Settlement
   * Submit bank confirmation and mark as completed
   */
  async reconcileSettlement(data: ReconcileSettlementDto): Promise<ReconcileResponseDto> {
    return reconcileOperation(this.repository, data);
  }


  /**
   * Split and allocate funds to suppliers and retailers based on settlement payload
   * Called when payment callback is received from M-Pesa
   */
  async splitAndAllocateFunds(data: any): Promise<any> {
    const timestamp = new Date().toISOString();

    // Find the settlement by merchant transaction reference
    const settlement = await this.repository.findSettlementByReference(data.merchantTransactionReference);
    if (!settlement) {
      this.logger.error('[SETTLEMENT][SPLIT] settlement not found', {
        timestamp,
        merchantTransactionReference: data.merchantTransactionReference,
      });
      throw new NotFoundException({
        statusCode: 404,
        message: 'Settlement not found for the provided merchant transaction reference',
        error: 'SETTLEMENT_NOT_FOUND',
      });
    }

    // Parse the payment payload to get supplier and retailer amounts
    const paymentPayload = (settlement.paymentPayload && typeof settlement.paymentPayload === 'object' && !Array.isArray(settlement.paymentPayload))
      ? (settlement.paymentPayload as Record<string, any>)
      : null;

    if (!paymentPayload) {
      this.logger.error('[SETTLEMENT][SPLIT] payment payload not found', {
        timestamp,
        settlementId: settlement.id,
      });
      throw new BadRequestException({
        statusCode: 400,
        message: 'Settlement payment payload not found',
        error: 'INVALID_SETTLEMENT_PAYLOAD',
      });
    }

    // Get supplier information from the payment payload
    const suppliers = Array.isArray(paymentPayload.suppliers) ? paymentPayload.suppliers : [];
    if (suppliers.length === 0) {
      this.logger.warn('[SETTLEMENT][SPLIT] no suppliers found in payment payload', {
        timestamp,
        settlementId: settlement.id,
      });
    }

    const supplierGroups = new Map<string, { merchantId: string; amount: number; retailerAmount: number; platformFee: number }>();
    let retailerAmount = 0;
    let platformFee = 0;
    for (const supplier of suppliers as Array<Record<string, any>>) {
      const items = Array.isArray(supplier.items) ? supplier.items : [];
      const supplierAmount = items.length > 0
        ? items.reduce((sum: number, item: any) => sum + Number(item.supplierAmount ?? 0), 0)
        : Number(supplier.supplierTotalAmount ?? 0);
      const supplierRetailerAmount = Number(supplier.retailerTotalAmount ?? 0);
      const supplierPlatformFee = Number(supplier.platformFee ?? 0);
      retailerAmount += supplierRetailerAmount;
      platformFee += supplierPlatformFee;
      const merchantId = String(supplier.supplierMerchantId ?? '').trim();
      if (!merchantId) continue;
      const existing = supplierGroups.get(merchantId);
      if (existing) {
        existing.amount += supplierAmount;
        existing.retailerAmount += supplierRetailerAmount;
        existing.platformFee += supplierPlatformFee;
      } else {
        supplierGroups.set(merchantId, { merchantId, amount: supplierAmount, retailerAmount: supplierRetailerAmount, platformFee: supplierPlatformFee });
      }
    }
    const supplierAllocations = Array.from(supplierGroups.values());

    // Create allocation record with M-Pesa details
    const existingMetadata = (settlement.metadata && typeof settlement.metadata === 'object') ? settlement.metadata as Record<string, any> : {};

    const paymentCallbackRecord = {
      merchantTransactionReference: data.merchantTransactionReference,
      status: 'SUCCESS',
      provider: 'M-PESA',
      providerReference: data.mpesaReceipt ?? data.mpesaCheckoutRequestId ?? data.mpesaMerchantRequestId ?? null,
      amount: Number(settlement.amount ?? 0),
      currency: settlement.currency ?? 'KES',
      metadata: {
        mpesaReceipt: data.mpesaReceipt ?? null,
        mpesaCheckoutRequestId: data.mpesaCheckoutRequestId ?? null,
        mpesaMerchantRequestId: data.mpesaMerchantRequestId ?? null,
        resultCode: data.resultCode ?? null,
        resultDesc: data.resultDesc ?? null,
      },
      receivedAt: timestamp,
    };

    const settlementMetadata = (settlement.metadata && typeof settlement.metadata === 'object' && !Array.isArray(settlement.metadata))
      ? (settlement.metadata as Record<string, any>)
      : {};
    const settlementPaymentPayload = (settlement.paymentPayload && typeof settlement.paymentPayload === 'object' && !Array.isArray(settlement.paymentPayload))
      ? (settlement.paymentPayload as Record<string, any>)
      : {};

    const resolvedRetailerMerchantId = await this.resolveRetailerMerchantId(settlement);

    const splitRecord = {
      timestamp,
      merchantTransactionReference: data.merchantTransactionReference,
      mpesaReceipt: data.mpesaReceipt ?? null,
      mpesaCheckoutRequestId: data.mpesaCheckoutRequestId ?? null,
      mpesaMerchantRequestId: data.mpesaMerchantRequestId ?? null,
      resultCode: data.resultCode ?? null,
      resultDesc: data.resultDesc ?? null,
      totalAmount: Number(settlement.amount),
      currency: settlement.currency ?? 'KES',
      allocations: {
        suppliers: supplierAllocations.map((supplier) => ({ merchantId: supplier.merchantId, amount: supplier.amount, status: 'PENDING_PAYOUT' })),
        retailer: {
          merchantId: resolvedRetailerMerchantId,
          amount: retailerAmount,
          status: 'PENDING_PAYOUT',
        },
      },
    };

    const splitRecords = Array.isArray(existingMetadata.splitRecords) ? existingMetadata.splitRecords : [];
    const updatedMetadata = {
      ...existingMetadata,
      paymentCallback: paymentCallbackRecord,
      paymentConfirmation: {
        ...paymentCallbackRecord,
        status: 'PAID',
        confirmedAt: timestamp,
      },
      splitRecords: [...splitRecords, splitRecord],
      lastSplitAt: timestamp,
    };

    // Update settlement status to indicate the settlement is in payout processing.
    await this.repository.updateSettlementStatus(settlement.id, SettlementStatus.PROCESSING, {
      metadata: updatedMetadata,
    });

    // Dispatch payouts to supplier and retailer
    const dispatchResults = {
      suppliers: [] as any[],
      retailer: null as any,
      errors: [] as any[],
    };

    // Dispatch to supplier
    for (const supplier of supplierAllocations) {
      if (!supplier.merchantId || supplier.amount <= 0) continue;
      try {
        const supplierDispatch = await this.dispatchB2bPayouts({
          merchantTransactionReference: data.merchantTransactionReference,
          party: 'SUPPLIER',
          supplierMerchantId: supplier.merchantId,
          amount: supplier.amount,
        });
        dispatchResults.suppliers.push({ supplierMerchantId: supplier.merchantId, result: supplierDispatch });
      } catch (supplierError) {
        const errorMsg = supplierError instanceof Error ? supplierError.message : String(supplierError);
        this.logger.error('[SETTLEMENT][SPLIT] supplier payout dispatch failed', {
          timestamp,
          settlementId: settlement.id,
          supplierMerchantId: supplier.merchantId,
          error: errorMsg,
        });
        dispatchResults.errors.push({
          party: 'SUPPLIER',
          supplierMerchantId: supplier.merchantId,
          amount: supplier.amount,
          error: errorMsg,
        });
      }
    }

    // Dispatch to retailer
    if (retailerAmount > 0) {
      try {
        dispatchResults.retailer = await this.dispatchB2bPayouts({
          merchantTransactionReference: data.merchantTransactionReference,
          party: 'RETAILER',
          amount: retailerAmount,
        });

      } catch (retailerError) {
        const errorMsg = retailerError instanceof Error ? retailerError.message : String(retailerError);
        this.logger.error('[SETTLEMENT][SPLIT] retailer payout dispatch failed', {
          timestamp,
          settlementId: settlement.id,
          error: errorMsg,
        });
        dispatchResults.errors.push({
          party: 'RETAILER',
          amount: retailerAmount,
          error: errorMsg,
        });
      }
    }

    const payoutCount = supplierAllocations.filter((supplier) => supplier.amount > 0).length + (retailerAmount > 0 ? 1 : 0);
    const successfulPayoutCount = dispatchResults.suppliers.length + (dispatchResults.retailer ? 1 : 0);
    const failedPayoutCount = dispatchResults.errors.length;
    const payoutStatus = successfulPayoutCount === 0 && failedPayoutCount > 0
      ? 'FAILED'
      : failedPayoutCount > 0
        ? 'PARTIALLY_FAILED'
        : 'PROCESSING';

    return {
      success: payoutStatus === 'PROCESSING',
      status: payoutStatus,
      settlementId: settlement.id,
      merchantTransactionReference: data.merchantTransactionReference,
      splitRecord,
      dispatchResults,
      errors: dispatchResults.errors.length > 0 ? dispatchResults.errors : null,
    };
  }

  async onModuleDestroy() {
    await this.prisma.$disconnect();
  }

  /**
   * Get retry statistics for a settlement
   */
  async getPayoutRetryStatistics(settlementId: string): Promise<any> {
    return this.retryService.getRetryStatistics(settlementId);
  }

  /**
   * Get all pending payouts due for retry
   */
  async getPendingPayoutRetries(): Promise<any[]> {
    return this.retryService.getPayoutsDueForRetry();
  }

  /**
   * Manually retry payouts for a settlement
   */
  async manualRetryPayouts(settlementId: string): Promise<any> {
    const settlement = await this.repository.findSettlementById(settlementId);
    if (!settlement) {
      throw new NotFoundException({
        statusCode: 404,
        message: 'Settlement not found',
        error: 'SETTLEMENT_NOT_FOUND',
      });
    }

    const payouts = await this.idempotencyService.getSettlementPayouts(settlementId);
    const failedPayouts = payouts.filter((p) => ['FAILED', 'RETRYING'].includes(p.status));

    if (failedPayouts.length === 0) {
      return {
        success: true,
        message: 'No failed payouts to retry',
        count: 0,
      };
    }

    const results = [];
    for (const payout of failedPayouts) {
      try {
        const dispatchResult = await this.dispatchB2bPayouts({
          merchantTransactionReference: payout.merchantTransactionReference,
          party: payout.party,
          supplierMerchantId: payout.recipientMerchantId,
          amount: Number(payout.amount),
        });

        results.push({
          payoutReference: payout.payoutReference,
          status: dispatchResult.status,
          success: dispatchResult.success,
        });
      } catch (error) {
        results.push({
          payoutReference: payout.payoutReference,
          status: 'FAILED',
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    return {
      success: true,
      message: `Manually retried ${failedPayouts.length} failed payouts`,
      count: failedPayouts.length,
      results,
    };
  }
}
