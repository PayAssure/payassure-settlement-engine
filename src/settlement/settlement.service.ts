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
import { b2pochiService } from '../payment/services/b2pochi.service';

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

  constructor(private readonly repository: SettlementRepository) {
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

    const supplierAmount = Number(settlement.amount) > 0 ? Number(settlement.amount) * 0.9 : 0;
    const retailerAmount = Number(settlement.amount) > 0 ? Number(settlement.amount) * 0.08 : 0;
    const platformFee = Number(settlement.amount) > 0 ? Number(settlement.amount) * 0.02 : 0;

    const paymentMethod = (settlement.paymentPayload && typeof settlement.paymentPayload === 'object' && !Array.isArray(settlement.paymentPayload)
      ? (settlement.paymentPayload as Record<string, any>).paymentMethod
      : null) as Record<string, any> | null;

    const metadata = (settlement?.metadata && typeof settlement.metadata === 'object' && !Array.isArray(settlement.metadata))
      ? (settlement.metadata as Record<string, any>)
      : {};
    const paymentPayload = (settlement?.paymentPayload && typeof settlement.paymentPayload === 'object' && !Array.isArray(settlement.paymentPayload))
      ? (settlement.paymentPayload as Record<string, any>)
      : {};

    const supplierMerchantId = this.resolveSupplierMerchantId(settlement, 'SUPPLIER');
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

  private resolvePayoutGateway(recipientType?: string): 'B2POCHI' | 'B2B' {
    const normalizedType = String(recipientType ?? '').trim().toUpperCase();
    return normalizedType === 'MPESA' ? 'B2POCHI' : 'B2B';
  }

  private async sendB2bGatewayPayoutRequest(payload: Record<string, any>): Promise<B2bGatewayResponse> {
    const payoutMetadata = (payload.metadata && typeof payload.metadata === 'object' && !Array.isArray(payload.metadata)) ? payload.metadata as Record<string, any> : {};
    const payoutPayment = (payoutMetadata.payment && typeof payoutMetadata.payment === 'object' && !Array.isArray(payoutMetadata.payment))
      ? payoutMetadata.payment as Record<string, any>
      : ((payload.payment && typeof payload.payment === 'object' && !Array.isArray(payload.payment)) ? payload.payment as Record<string, any> : {});
    const recipientPhoneNumber = payload.recipientPhoneNumber ?? payoutPayment.phoneNumber ?? payoutPayment.payerPhoneNumber ?? null;
    const recipientType = String(payload.recipientType ?? payoutPayment.type ?? (recipientPhoneNumber ? 'MPESA' : 'BANK')).trim().toUpperCase();
    const resolvedRecipientType = recipientType === 'MPESA' || recipientType === 'BANK' ? recipientType : (recipientPhoneNumber ? 'MPESA' : 'BANK');
    const selectedGateway = this.resolvePayoutGateway(resolvedRecipientType);

    this.logger.log('[B2B][DISPATCH][GATEWAY][ROUTE]', {
      recipientType,
      selectedGateway,
      settlementId: payload.metadata?.settlementId ?? payload.settlementId ?? null,
      party: payload.party ?? null,
      amount: Number(payload.amount ?? 0),
      phoneNumber: recipientPhoneNumber,
      payerPhoneNumber: payload.recipientPhoneNumber ?? payload.payerPhoneNumber ?? null,
      recipientShortCode: payload.recipientShortCode ?? payload.accountReference ?? null,
      callbackUrl: payload.callbackUrl ?? process.env.MPESA_CALLBACK_URL ?? process.env.B2B_PAYOUT_CALLBACK_URL ?? process.env.PAYMENT_GATEWAY_CALLBACK_URL,
      timestamp: new Date().toISOString(),
    });

    try {
      if (resolvedRecipientType === 'MPESA') {
        const partyB = payload.recipientPhoneNumber ?? payload.phoneNumber ?? payload.payerPhoneNumber ?? payload.metadata?.payment?.phoneNumber ?? payload.metadata?.payment?.payerPhoneNumber ?? payload.recipientShortCode ?? '';
        const request = {
          OriginatorConversationID: payload.reference ?? payload.merchantTransactionReference ?? `${Date.now()}_pochi_${Math.random().toString(36).slice(2, 10)}`,
          CommandID: 'BusinessPayToPochi',
          Amount: String(Number(payload.amount ?? 0)),
          PartyB: partyB,
          Remarks: payload.remarks ?? payload.description ?? `B2Pochi payout to ${payload.party ?? 'recipient'}`,
          QueueTimeOutURL: payload.callbackUrl ?? process.env.MPESA_CALLBACK_URL ?? process.env.B2B_PAYOUT_CALLBACK_URL ?? process.env.PAYMENT_GATEWAY_CALLBACK_URL,
          ResultURL: payload.callbackUrl ?? process.env.MPESA_CALLBACK_URL ?? process.env.B2B_PAYOUT_CALLBACK_URL ?? process.env.PAYMENT_GATEWAY_CALLBACK_URL,
          Occassion: payload.description ?? payload.remarks ?? `B2Pochi payout to ${payload.party ?? 'recipient'}`,
        };

        this.logger.log('[B2B][DISPATCH][GATEWAY][B2POCHI] attempting to call b2pochiService.initiateB2Pochi', {
          recipientType,
          partyB,
          amount: Number(payload.amount ?? 0),
          callbackUrl: request.QueueTimeOutURL,
          timestamp: new Date().toISOString(),
        });

        const response = await b2pochiService.initiateB2Pochi(request as Record<string, any>);
        const responseCode = response?.responseCode ?? response?.ResponseCode ?? 'UNKNOWN';
        const responseDescription = response?.responseDescription ?? response?.ResponseDescription ?? 'Unknown B2Pochi gateway response';
        const isAcceptedBySafaricom = String(responseCode) === '0';

        this.logger.log('[B2B][DISPATCH][GATEWAY][B2POCHI][RESPONSE]', {
          recipientType,
          isAcceptedBySafaricom,
          responseCode,
          responseDescription,
          fullResponse: response,
        });

        return {
          success: isAcceptedBySafaricom,
          statusCode: 200,
          responseCode: String(responseCode),
          responseDescription: String(responseDescription),
          response,
        };
      }

      this.logger.log('[B2B][DISPATCH][GATEWAY][B2B] attempting to call b2bService.initiateB2B', {
        recipientShortCode: payload.recipientShortCode ?? payload.recipientPhoneNumber ?? payload.accountReference ?? '174379',
        amount: Number(payload.amount ?? 0),
        description: payload.description ?? payload.remarks ?? 'Settlement payout',
        accountReference: payload.accountReference ?? payload.metadata?.supplierMerchantId ?? 'B2B Payment',
        callbackUrl: payload.callbackUrl ?? process.env.MPESA_CALLBACK_URL ?? process.env.B2B_PAYOUT_CALLBACK_URL ?? process.env.PAYMENT_GATEWAY_CALLBACK_URL,
        timestamp: new Date().toISOString(),
      });

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

      this.logger.log('[B2B][DISPATCH][GATEWAY][B2B][RESPONSE]', {
        recipientType,
        isAcceptedBySafaricom,
        responseCode,
        responseDescription,
        fullResponse: response,
      });

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
        selectedGateway,
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
          checkSecurityCredential: process.env.MPESA_SECURITY_CREDENTIAL ? 'SET' : 'MISSING',
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

      this.logger.log(`[B2B][RECIPIENT] resolving retailer payout using merchantId=${retailerMerchantId ?? 'n/a'} settlementId=${settlement?.id ?? 'n/a'}`);

      if (retailerMerchantId) {
        const retailerIntegration = await this.repository.findIntegrationByMerchantId(String(retailerMerchantId));
        if (retailerIntegration?.participant?.payment) {
          const payment = retailerIntegration.participant.payment as any;
          this.logger.log(`[B2B][RECIPIENT] retailer payout loaded from merchant integration merchantId=${retailerMerchantId}, type=${payment.type ?? 'n/a'}`);
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

    this.logger.log(`[B2B][RECIPIENT] resolving supplier payout for supplierMerchantId=${supplierId}`);

    const payment = (settlement.paymentSnapshot ?? null) as any;
    if (payment && payment.type) {
      this.logger.log(`[B2B][RECIPIENT] using settlement payment snapshot for supplier=${supplierId}`);
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

    this.logger.log(`[B2B][RECIPIENT] supplier payout details loaded from integration merchantId=${supplierId}, type=${supplierPayment.type}`);

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
    this.logger.log(`[B2B][DISPATCH] starting payout dispatch for merchantTransactionReference=${data.merchantTransactionReference} party=${data.party ?? 'UNKNOWN'}`);

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
    this.logger.log(`[B2B][DISPATCH] resolved party=${party} supplierMerchantId=${resolvedSupplierMerchantId ?? 'n/a'} retailerMerchantId=${resolvedRetailerMerchantId ?? 'n/a'} retailerParticipantId=${workingSettlement.businessId ?? settlement.businessId ?? 'n/a'} for settlement=${workingSettlement.id ?? settlement.id}`);
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
      this.logger.log(`[B2B][DISPATCH] payout amount rounded from ${amount} to ${roundedAmount} for settlement=${settlement.id} party=${party}`);
    }

    const payoutReference = data.payoutReference ?? `${workingSettlement.merchantTransactionReference}-${party}-${Date.now()}`;
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

    this.logger.log(`[B2B][DISPATCH] settlement=${settlement.id} party=${party} amount=${amount} recipientShortCode=${recipientShortCode} accountReference=${recipient.accountName} callbackUrl=${callbackUrl ?? 'unset'}`);
    this.logger.log('[B2B][DISPATCH][RECIPIENT] payout recipient resolved for dispatch', {
      timestamp: new Date().toISOString(),
      settlementId: settlement.id,
      party,
      supplierMerchantId: party === 'SUPPLIER' ? (resolvedSupplierMerchantId ?? null) : null,
      retailerMerchantId: party === 'RETAILER' ? (resolvedRetailerMerchantId ?? null) : null,
      retailerParticipantId: settlement.businessId ?? null,
      recipientType: recipient.type,
      recipientProvider: recipient.provider ?? null,
      recipientShortCode,
      accountName: recipient.accountName ?? null,
      payerPhoneNumber: recipient.payerPhoneNumber ?? null,
      payment: payoutPayment,
    });
    this.logger.log('[B2B][DISPATCH][REQUEST] outbound payout request payload', {
      timestamp: new Date().toISOString(),
      settlementId: workingSettlement.id ?? settlement.id,
      merchantTransactionReference: workingSettlement.merchantTransactionReference ?? settlement.merchantTransactionReference,
      party,
      requestPayload,
      gatewayBaseUrl: await this.getB2bGatewayBaseUrl(),
      gatewayPath: process.env.B2B_GATEWAY_PAYOUT_PATH ?? '/api/payments/mpesa/b2b',
      hasAuthorizationToken: !!this.getB2bGatewayApiToken(),
    });
    this.logger.log(`[B2B][DISPATCH][EXACT][${party}] payload=${JSON.stringify(requestPayload, null, 2)}`);
    this.logger.log(`[B2B][DISPATCH][EXACT][${party}] gatewayRequest=${JSON.stringify({
      settlementId: workingSettlement.id ?? settlement.id,
      merchantTransactionReference: workingSettlement.merchantTransactionReference ?? settlement.merchantTransactionReference,
      party,
      amount: roundedAmount,
      recipientType: recipient.type,
      recipientShortCode,
      accountReference: recipient.accountName,
      callbackUrl: callbackUrl ?? null,
      remarks: `B2B payout to ${party}`,
      description: `Settlement payout for ${party}`,
      metadata: requestPayload.metadata,
    }, null, 2)}`);
    const gatewayResult = await this.sendB2bGatewayPayoutRequest(requestPayload);
    this.logger.log(`[B2B][DISPATCH] payoutReference=${payoutReference} settled=${settlement.id} gatewayResult=${JSON.stringify(gatewayResult, null, 2)}`);

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
    this.logger.log('[B2B][CALLBACK][REQUEST]', {
      timestamp: new Date().toISOString(),
      callbackIdentifier: callbackIdentifier ?? data?.callbackIdentifier ?? data?.callbackToken ?? null,
      merchantTransactionReference: data?.merchantTransactionReference ?? null,
      reference: data?.reference ?? null,
      party: data?.party ?? null,
      status: data?.status ?? null,
      supplierMerchantId: data?.supplierMerchantId ?? null,
      rawPayload: data,
    });

    // PRIMARY LOOKUP: Use callbackIdentifier from URL path (most reliable)
    let settlement = null;
    if (callbackIdentifier) {
      settlement = await this.repository.findSettlementByPayoutCallbackIdentifier(callbackIdentifier);
      if (settlement) {
        this.logger.log('[B2B][CALLBACK][LOOKUP] found settlement by callbackIdentifier', {
          settlementId: settlement.id,
          callbackIdentifier,
        });
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
          this.logger.log('[B2B][CALLBACK][LOOKUP] found settlement by fallback reference', {
            settlementId: settlement.id,
            reference: ref,
          });
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

    this.logger.log(`[B2B][CALLBACK] settlementId=${settlement.id} party=${party} reference=${data.reference} status=${status} nextStatus=${nextStatus}`);
    this.logger.log('[B2B][CALLBACK][RESULT]', {
      timestamp: new Date().toISOString(),
      settlementId: settlement.id,
      merchantTransactionReference: settlement.merchantTransactionReference,
      party,
      payoutReference: data.reference ?? null,
      callbackStatus: status,
      nextStatus,
      lastPayoutCallback: payoutCallback,
    });

    return {
      success: true,
      status: nextStatus,
      settlementId: settlement.id,
      payoutCallback,
    };
  }

  async confirmSettlementPayment(data: PaymentConfirmationDto): Promise<any> {
    this.logger.log(`[CONFIRMATION][LOOKUP] starting lookup for ${data.settlementId}`);

    let settlement = await this.repository.findSettlementById(data.settlementId);
    this.logger.log(`[CONFIRMATION][LOOKUP] direct id lookup ${settlement ? 'matched' : 'missed'} for ${data.settlementId}`);

    if (!settlement) {
      const fallbackSettlement = await this.repository.findSettlementByReference?.(data.settlementId);
      settlement = fallbackSettlement ?? null;
      this.logger.log(`[CONFIRMATION][LOOKUP] reference fallback ${settlement ? 'matched' : 'missed'} for ${data.settlementId}`);
    }

    if (!settlement) {
      this.logger.warn(`[CONFIRMATION][LOOKUP] failed: settlement ${data.settlementId} was not found`);
      throw new NotFoundException({ statusCode: 404, message: 'Settlement not found for the provided settlement identifier', error: 'SETTLEMENT_NOT_FOUND' });
    }

    this.logger.log(`[CONFIRMATION][LOOKUP] resolved settlement ${settlement.id} with reference=${settlement.merchantTransactionReference ?? 'n/a'} originalReference=${(settlement.metadata as any)?.originalMerchantReference ?? 'n/a'}`);

    if ((settlement.status as string) === 'PENDING_PROCESSING' || (settlement.status as string) === 'PROCESSING' || (settlement.status as string) === 'COMPLETED') {
      this.logger.log(`[CONFIRMATION][RESULT] settlement ${settlement.id} already processed with status ${settlement.status}`);
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

    const supplierAmount = Number(settlement.amount) > 0 ? Number(settlement.amount) * 0.9 : 0;
    const retailerAmount = Number(settlement.amount) > 0 ? Number(settlement.amount) * 0.08 : 0;
    const platformFee = Number(settlement.amount) > 0 ? Number(settlement.amount) * 0.02 : 0;

    const paymentMethod = (settlement.paymentPayload && typeof settlement.paymentPayload === 'object' && !Array.isArray(settlement.paymentPayload)
      ? (settlement.paymentPayload as Record<string, any>).paymentMethod
      : null) as Record<string, any> | null;

    const metadata = (settlement?.metadata && typeof settlement.metadata === 'object' && !Array.isArray(settlement.metadata))
      ? (settlement.metadata as Record<string, any>)
      : {};
    const paymentPayload = (settlement?.paymentPayload && typeof settlement.paymentPayload === 'object' && !Array.isArray(settlement.paymentPayload))
      ? (settlement.paymentPayload as Record<string, any>)
      : {};

    const supplierMerchantId = this.resolveSupplierMerchantId(settlement, 'SUPPLIER');
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

    this.logger.log(`[CONFIRMATION][RESULT] accepting payment confirmation for settlement ${settlement.id}: amount=${paymentConfirmation.paidAmount} provider=${paymentConfirmation.provider ?? 'n/a'} receipt=${paymentConfirmation.providerReference?.receiptNumber ?? 'n/a'}`);

    await this.repository.updateSettlementStatus(settlement.id, 'PENDING_PROCESSING', {
      metadata: {
        ...existingMetadata,
        paymentConfirmation,
        allocationPlan,
      },
    });

    this.logger.log(`[CONFIRMATION][RESULT] settlement=${settlement.id} payment confirmed; allocation plan created supplier=${supplierAmount} retailer=${retailerAmount} platformFee=${platformFee}`);

    const dispatchResults: Array<any> = [];
    try {
      this.logger.log(`[CONFIRMATION][DISPATCH] starting payout dispatch for settlement ${settlement.id}`);
      const settlementMetadata = (settlement.metadata && typeof settlement.metadata === 'object') ? settlement.metadata as Record<string, any> : {};
      const supplierDispatch = await this.dispatchB2bPayouts({
        merchantTransactionReference: settlement.merchantTransactionReference,
        party: 'SUPPLIER',
        amount: supplierAmount,
        supplierMerchantId: settlementMetadata.supplierMerchantId ?? undefined,
      });
      dispatchResults.push({ party: 'SUPPLIER', result: supplierDispatch });
    } catch (error) {
      this.logger.warn(`[CONFIRMATION][DISPATCH] supplier payout dispatch failed for settlement ${settlement.id}: ${error instanceof Error ? error.message : String(error)}`);
      dispatchResults.push({ party: 'SUPPLIER', error: error instanceof Error ? error.message : String(error) });
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

    this.logger.log('[SETTLEMENT][SPLIT] splitting funds for settlement', {
      timestamp,
      merchantTransactionReference: data.merchantTransactionReference,
      mpesaReceipt: data.mpesaReceipt,
    });

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

    this.logger.log('[SETTLEMENT][SPLIT] settlement found', {
      timestamp,
      settlementId: settlement.id,
      amount: settlement.amount,
      currency: settlement.currency,
    });

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

    const firstSupplier = suppliers[0] as Record<string, any> | undefined;
    const supplierMerchantId = firstSupplier?.supplierMerchantId ?? null;
    const supplierAmount = firstSupplier?.supplierTotalAmount ?? 0;
    const retailerAmount = firstSupplier?.retailerTotalAmount ?? 0;

    this.logger.log('[SETTLEMENT][SPLIT] parsed settlement amounts', {
      timestamp,
      settlementId: settlement.id,
      supplierMerchantId,
      supplierAmount,
      retailerAmount,
    });

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
        supplier: {
          merchantId: supplierMerchantId,
          amount: supplierAmount,
          status: 'PENDING_PAYOUT',
        },
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

    this.logger.log('[SETTLEMENT][SPLIT][CALLBACK] persisted callback metadata before payout dispatch', {
      timestamp,
      settlementId: settlement.id,
      merchantTransactionReference: data.merchantTransactionReference,
      paymentCallbackRecord,
      allocationPlan: (updatedMetadata as Record<string, any>).allocationPlan ?? null,
    });

    // Update settlement status to indicate the settlement is in payout processing.
    await this.repository.updateSettlementStatus(settlement.id, SettlementStatus.PROCESSING, {
      metadata: updatedMetadata,
    });

    this.logger.log('[SETTLEMENT][SPLIT] settlement marked as PROCESSING', {
      timestamp,
      settlementId: settlement.id,
      supplierAmount,
      retailerAmount,
    });

    // Dispatch payouts to supplier and retailer
    const dispatchResults = {
      supplier: null as any,
      retailer: null as any,
      errors: [] as any[],
    };

    // Dispatch to supplier
    if (supplierMerchantId && supplierAmount > 0) {
      try {
        this.logger.log('[SETTLEMENT][SPLIT] dispatching payout to supplier', {
          timestamp,
          settlementId: settlement.id,
          supplierMerchantId,
          amount: supplierAmount,
        });

        dispatchResults.supplier = await this.dispatchB2bPayouts({
          merchantTransactionReference: data.merchantTransactionReference,
          party: 'SUPPLIER',
          supplierMerchantId,
          amount: supplierAmount,
        });

        this.logger.log('[SETTLEMENT][SPLIT] supplier payout dispatched', {
          timestamp,
          settlementId: settlement.id,
          supplierMerchantId,
          payoutReference: dispatchResults.supplier.payoutReference,
          status: dispatchResults.supplier.status,
        });
      } catch (supplierError) {
        const errorMsg = supplierError instanceof Error ? supplierError.message : String(supplierError);
        this.logger.error('[SETTLEMENT][SPLIT] supplier payout dispatch failed', {
          timestamp,
          settlementId: settlement.id,
          supplierMerchantId,
          error: errorMsg,
        });
        dispatchResults.errors.push({
          party: 'SUPPLIER',
          supplierMerchantId,
          amount: supplierAmount,
          error: errorMsg,
        });
      }
    }

    // Dispatch to retailer
    if (retailerAmount > 0) {
      try {
        this.logger.log('[SETTLEMENT][SPLIT] dispatching payout to retailer', {
          timestamp,
          settlementId: settlement.id,
          amount: retailerAmount,
        });

        dispatchResults.retailer = await this.dispatchB2bPayouts({
          merchantTransactionReference: data.merchantTransactionReference,
          party: 'RETAILER',
          amount: retailerAmount,
        });

        this.logger.log('[SETTLEMENT][SPLIT] retailer payout submitted to B2B gateway', {
          timestamp,
          settlementId: settlement.id,
          payoutReference: dispatchResults.retailer.payoutReference,
          status: dispatchResults.retailer.status,
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

    // Final log
    const hasPayoutFailures = dispatchResults.errors.length > 0;
    const payoutStatus = hasPayoutFailures ? 'FAILED' : 'COMPLETED';

    this.logger.log('[SETTLEMENT][SPLIT] split and allocation completed', {
      timestamp,
      settlementId: settlement.id,
      supplierPayoutStatus: dispatchResults.supplier?.status ?? 'SKIPPED',
      retailerPayoutStatus: dispatchResults.retailer?.status ?? 'SKIPPED',
      errorCount: dispatchResults.errors.length,
      payoutStatus,
    });

    return {
      success: !hasPayoutFailures,
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
}
