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

interface B2bPayoutRecipient {
  type: string;
  provider?: string | null;
  shortcode?: string | null;
  accountName?: string | null;
  payerPhoneNumber?: string | null;
}

interface B2bGatewayResponse {
  success: boolean;
  statusCode?: number;
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
          type: paymentMethod?.type ?? 'MPESA',
          provider: paymentMethod?.provider ?? 'Safaricom',
          payerPhoneNumber: paymentMethod?.payerPhoneNumber ?? null,
        },
        retailer: {
          type: paymentMethod?.type ?? 'MPESA',
          provider: paymentMethod?.provider ?? 'Safaricom',
          payerPhoneNumber: paymentMethod?.payerPhoneNumber ?? null,
        },
      },
    };

    await this.repository.updateSettlementStatus(settlement.id, 'PENDING_PROCESSING', {
      metadata: {
        ...existingMetadata,
        paymentCallback,
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

  private getB2bPayoutCallbackUrl(): string | null {
    const callbackBase = process.env.B2B_PAYOUT_CALLBACK_URL || process.env.PAYMENT_GATEWAY_CALLBACK_URL || process.env.MPESA_CALLBACK_URL;
    return callbackBase ? callbackBase.replace(/\/+$/, '') + '/settlement/payouts/callback' : null;
  }

  private getB2bGatewayApiToken(): string | null {
    return process.env.B2B_GATEWAY_API_TOKEN || process.env.PAYMENT_GATEWAY_API_TOKEN || process.env.SETTLEMENT_API_TOKEN || null;
  }

  private async sendB2bGatewayPayoutRequest(payload: Record<string, any>): Promise<B2bGatewayResponse> {
    const gatewayBaseUrl = await this.getB2bGatewayBaseUrl();
    if (!gatewayBaseUrl) {
      this.logger.warn('[B2B][DISPATCH] B2B gateway base URL is not configured. Dispatch request will be recorded but not sent.');
      return { success: false, error: 'B2B_GATEWAY_BASE_URL_NOT_CONFIGURED' };
    }

    const payoutPath = process.env.B2B_GATEWAY_PAYOUT_PATH ?? '/api/payments/mpesa/b2b';
    const url = new URL(payoutPath, gatewayBaseUrl);
    const body = JSON.stringify(payload);
    const clientRequest = url.protocol === 'http:' ? httpRequest : httpsRequest;
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(body).toString(),
    };

    const apiToken = this.getB2bGatewayApiToken();
    if (apiToken) {
      headers.Authorization = `Bearer ${apiToken}`;
    }

    return new Promise<B2bGatewayResponse>((resolve) => {
      const req = clientRequest(
        url,
        {
          method: 'POST',
          headers,
        },
        (res) => {
          const chunks: Buffer[] = [];
          res.on('data', (chunk) => chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)));
          res.on('end', () => {
            const raw = Buffer.concat(chunks).toString('utf8');
            const statusCode = res.statusCode ?? 0;
            if (statusCode >= 200 && statusCode < 300) {
              try {
                const parsed = raw ? JSON.parse(raw) : {};
                return resolve({ success: true, statusCode, response: parsed });
              } catch (error) {
                return resolve({ success: true, statusCode, response: raw });
              }
            }
            let response: any = raw;
            try {
              response = raw ? JSON.parse(raw) : raw;
            } catch (_err) {
              response = raw;
            }
            resolve({ success: false, statusCode, response, error: `Gateway returned ${statusCode}` });
          });
        },
      );

      req.setTimeout(30000, () => {
        req.destroy(new Error('B2B gateway request timed out after 30000ms'));
      });
      req.on('error', (err) => {
        resolve({ success: false, error: err instanceof Error ? err.message : String(err) });
      });
      req.write(body);
      req.end();
    });
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

  private async resolveB2bRecipient(settlement: any, party: 'SUPPLIER' | 'RETAILER', supplierMerchantId?: string): Promise<B2bPayoutRecipient> {
    if (party === 'RETAILER') {
      const participant = await this.prisma.onboardingParticipant.findUnique({ where: { id: settlement.businessId } });
      this.logger.log(`[B2B][RECIPIENT] resolving retailer payout using authenticated participant merchantId=${settlement.businessId}`);
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
        payerPhoneNumber: payment.payerPhoneNumber ?? null,
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
        payerPhoneNumber: payment.payerPhoneNumber ?? null,
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
      payerPhoneNumber: supplierPayment.payerPhoneNumber ?? null,
    };
  }

  async dispatchB2bPayouts(data: any): Promise<any> {
    this.logger.log(`[B2B][DISPATCH] starting payout dispatch for merchantTransactionReference=${data.merchantTransactionReference} party=${data.party ?? 'UNKNOWN'}`);

    const settlement = await this.repository.findSettlementByReference(data.merchantTransactionReference);
    if (!settlement) {
      throw new NotFoundException({ statusCode: 404, message: 'Settlement not found for the provided merchant transaction reference', error: 'SETTLEMENT_NOT_FOUND' });
    }
    const existingMetadata = (settlement.metadata && typeof settlement.metadata === 'object') ? settlement.metadata as Record<string, any> : {};

    const callbackStatus = existingMetadata.paymentCallback?.status ?? existingMetadata.paymentConfirmation?.status;
    if (!callbackStatus || !['SUCCESS', 'PAID'].includes(String(callbackStatus).toUpperCase())) {
      throw new NotFoundException({ statusCode: 404, message: 'A successful payment callback or confirmation has not been recorded for this settlement', data: { existingMetadata }, error: 'PAYMENT_NOT_CONFIRMED' });
    }
    const party = (String(data.party || (existingMetadata?.supplierMerchantId ? 'SUPPLIER' : 'RETAILER')).toUpperCase() as 'SUPPLIER' | 'RETAILER');
    const resolvedSupplierMerchantId = this.resolveSupplierMerchantId(settlement, party, data.supplierMerchantId);
    this.logger.log(`[B2B][DISPATCH] resolved party=${party} supplierMerchantId=${resolvedSupplierMerchantId ?? 'n/a'} retailerParticipantId=${settlement.businessId ?? 'n/a'} for settlement=${settlement.id}`);
    const recipient = await this.resolveB2bRecipient(settlement, party, resolvedSupplierMerchantId ?? undefined);

    if (recipient.type === 'BANK') {
      if (!recipient.shortcode || !recipient.accountName) {
        throw new BadRequestException({ statusCode: 400, message: 'Bank payouts require a recipient shortcode and accountName', error: 'BANK_PAYOUT_DETAILS_INCOMPLETE' });
      }
    }
    if (recipient.type === 'MPESA') {
      if (!recipient.payerPhoneNumber) {
        throw new BadRequestException({ statusCode: 400, message: 'MPESA payouts require a recipient payerPhoneNumber', error: 'MPESA_PAYOUT_DETAILS_INCOMPLETE' });
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

    const payoutReference = data.payoutReference ?? `${settlement.merchantTransactionReference}-${party}-${Date.now()}`;
    const callbackUrl = this.getB2bPayoutCallbackUrl();
    const recipientShortCode = recipient.shortcode ?? recipient.payerPhoneNumber ?? null;

    const requestPayload = {
      reference: payoutReference,
      merchantTransactionReference: settlement.merchantTransactionReference,
      settlementReference: settlement.reference,
      party,
      amount: roundedAmount,
      currency: settlement.currency ?? 'KES',
      recipientShortCode,
      accountReference: recipient.accountName,
      remarks: `B2B payout to ${party}`,
      description: `Settlement payout for ${party}`,
      callbackUrl: callbackUrl ?? undefined,
      recipientType: recipient.type,
      recipientProvider: recipient.provider,
      recipientPhoneNumber: recipient.payerPhoneNumber ?? undefined,
      metadata: {
        settlementId: settlement.id,
        party,
        supplierMerchantId: resolvedSupplierMerchantId ?? null,
        ...((data.metadata ?? {}) as Record<string, any>),
      },
    };

    this.logger.log(`[B2B][DISPATCH] settlement=${settlement.id} party=${party} amount=${amount} recipientShortCode=${recipientShortCode} accountReference=${recipient.accountName} callbackUrl=${callbackUrl ?? 'unset'}`);
    this.logger.log('[B2B][DISPATCH][RECIPIENT] payout recipient resolved for dispatch', {
      timestamp: new Date().toISOString(),
      settlementId: settlement.id,
      party,
      supplierMerchantId: resolvedSupplierMerchantId ?? null,
      retailerParticipantId: settlement.businessId ?? null,
      recipientType: recipient.type,
      recipientProvider: recipient.provider ?? null,
      recipientShortCode,
      accountName: recipient.accountName ?? null,
      payerPhoneNumber: recipient.payerPhoneNumber ?? null,
    });
    this.logger.log(`[B2B][DISPATCH] payload=${JSON.stringify(requestPayload, null, 2)}`);
    const gatewayResult = await this.sendB2bGatewayPayoutRequest(requestPayload);
    this.logger.log(`[B2B][DISPATCH] payoutReference=${payoutReference} settled=${settlement.id} gatewayResult=${JSON.stringify(gatewayResult, null, 2)}`);

    const payoutDispatches = Array.isArray(existingMetadata.payoutDispatches) ? existingMetadata.payoutDispatches : [];
    const payoutDispatchAuditLog = Array.isArray(existingMetadata.payoutDispatchAuditLog) ? existingMetadata.payoutDispatchAuditLog : [];
    const dispatchRecord = {
      reference: payoutReference,
      party,
      status: gatewayResult.success ? 'DISPATCHED' : 'FAILED',
      amount,
      recipient,
      requestPayload,
      gatewayResult,
      requestedAt: new Date().toISOString(),
    };

    const auditEntry = {
      event: gatewayResult.success ? 'B2B_DISPATCH_SUCCESS' : 'B2B_DISPATCH_FAILURE',
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
        error: gatewayResult.error ?? null,
      },
      payloadHash: Buffer.from(JSON.stringify(requestPayload)).toString('base64'),
      createdAt: new Date().toISOString(),
    };

    await this.repository.updateSettlementStatus(settlement.id, 'PROCESSING', {
      metadata: {
        ...existingMetadata,
        payoutDispatches: [...payoutDispatches, dispatchRecord],
        payoutDispatchAuditLog: [...payoutDispatchAuditLog, auditEntry],
      },
    });

    return {
      success: true,
      status: dispatchRecord.status,
      payoutReference,
      gatewayResult,
      dispatchRecord,
    };
  }

  async handleB2bPayoutCallback(data: any): Promise<any> {
    const settlement = await this.repository.findSettlementByReference(data.merchantTransactionReference);
    if (!settlement) {
      throw new NotFoundException({ statusCode: 404, message: 'Settlement not found for the provided merchant transaction reference', error: 'SETTLEMENT_NOT_FOUND' });
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

    this.logger.log(`[B2B][CALLBACK] settlementId=${settlement.id} party=${party} reference=${data.reference} status=${status}`);

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
          type: paymentMethod?.type ?? 'MPESA',
          provider: paymentMethod?.provider ?? 'Safaricom',
          payerPhoneNumber: paymentMethod?.payerPhoneNumber ?? null,
        },
        retailer: {
          type: paymentMethod?.type ?? 'MPESA',
          provider: paymentMethod?.provider ?? 'Safaricom',
          payerPhoneNumber: paymentMethod?.payerPhoneNumber ?? null,
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
          merchantId: settlement.businessId ?? null,
          amount: retailerAmount,
          status: 'PENDING_PAYOUT',
        },
      },
    };

    const splitRecords = Array.isArray(existingMetadata.splitRecords) ? existingMetadata.splitRecords : [];
    const updatedMetadata = {
      ...existingMetadata,
      paymentCallback: paymentCallbackRecord,
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

        this.logger.log('[SETTLEMENT][SPLIT] retailer payout dispatched', {
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
    this.logger.log('[SETTLEMENT][SPLIT] split and allocation completed', {
      timestamp,
      settlementId: settlement.id,
      supplierPayoutStatus: dispatchResults.supplier?.status ?? 'SKIPPED',
      retailerPayoutStatus: dispatchResults.retailer?.status ?? 'SKIPPED',
      errorCount: dispatchResults.errors.length,
    });

    return {
      success: true,
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
