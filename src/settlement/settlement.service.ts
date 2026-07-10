import { ForbiddenException, Injectable, Logger, NotFoundException, UnauthorizedException } from '@nestjs/common';
import { ParticipantStatus, ParticipantType, PrismaClient } from '@prisma/client';
import { SettlementRepository } from './settlement.repository';
import { AuthenticateDto } from './dto/authenticate.dto';
import { InitiateSettlementDto } from './dto/initiate-settlement.dto';
import { ReconcileSettlementDto } from './dto/reconcile-settlement.dto';
import PaymentCallbackDto from './dto/payment-callback.dto';
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

interface FakeB2bPayoutRecord {
  transactionId: string;
  reference: string;
  settlementReference?: string;
  merchantTransactionReference?: string;
  status: 'PROCESSING' | 'SUCCESS' | 'FAILED';
  providerReference?: string;
  payload: Record<string, any>;
  createdAt: string;
  updatedAt: string;
}

@Injectable()
export class SettlementService {
  private prisma: PrismaClient;
  private readonly logger = new Logger(SettlementService.name);
  private readonly TOKEN_EXPIRY = 3600; // 1 hour in seconds
  private readonly SUPPORTED_CURRENCIES = ['KES', 'USD', 'TZS'];
  private readonly fakeB2bPayouts = new Map<string, FakeB2bPayoutRecord>();

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

  async simulateLedgerPayouts(data: { merchantTransactionReference: string; simulationStatus?: string }): Promise<any> {
    const settlement = await this.repository.findSettlementByReference(data.merchantTransactionReference);

    if (!settlement) {
      throw new NotFoundException({ statusCode: 404, message: 'Settlement not found for the provided merchant transaction reference', error: 'SETTLEMENT_NOT_FOUND' });
    }

    const callbackMetadata = (settlement.metadata && typeof settlement.metadata === 'object' ? settlement.metadata as Record<string, any> : {});
    const callbackStatus = callbackMetadata.paymentCallback?.status ?? 'UNKNOWN';
    const allocationPlan = callbackMetadata.allocationPlan ?? {
      allocations: [],
    };

    if (callbackStatus !== 'SUCCESS') {
      throw new NotFoundException({ statusCode: 404, message: 'A successful payment callback was not found for this transaction', error: 'CALLBACK_NOT_FOUND' });
    }

    const simulationStatus = data.simulationStatus ?? 'PENDING';
    const startedAt = new Date().toISOString();
    const payoutTransactions = (allocationPlan.allocations ?? []).map((allocation: any, index: number) => {
      const payoutReference = `${settlement.reference ?? settlement.merchantTransactionReference ?? 'settlement'}-${index + 1}`;
      const payoutRequest = {
        reference: payoutReference,
        fromMerchantId: 'PAYASSURE',
        toMerchantId: allocation.party === 'Platform' ? 'PAYASSURE' : `SUPPLIER-${index + 1}`,
        amount: Number(allocation.amount ?? 0),
        currency: settlement.currency ?? 'KES',
        paymentMethod: {
          type: 'MPESA',
          provider: 'Safaricom',
          phoneNumber: '+254700000000',
        },
        settlementReference: settlement.reference,
        merchantTransactionReference: settlement.merchantTransactionReference,
      };

      const gatewayResponse = {
        transactionId: `B2B-${Date.now()}-${index + 1}`,
        status: 'PROCESSING',
        message: 'Payout accepted by fake B2B gateway.',
        reference: payoutReference,
      };

      this.fakeB2bPayouts.set(payoutReference, {
        transactionId: gatewayResponse.transactionId,
        reference: payoutReference,
        settlementReference: settlement.reference,
        merchantTransactionReference: settlement.merchantTransactionReference,
        status: 'PROCESSING',
        payload: payoutRequest,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      });

      return {
        id: `payout-${settlement.id}-${index + 1}`,
        party: allocation.party,
        amount: Number(allocation.amount ?? 0),
        destination: allocation.destination ?? 'B2B payout',
        status: simulationStatus,
        provider: 'FAKE_B2B_SIMULATOR',
        simulatedAt: new Date().toISOString(),
        ledgerReference: payoutReference,
        details: `Ledger created payout instruction for ${allocation.party}; fake B2B gateway accepted the request and returned a processing acknowledgment.`,
        gatewayResponse,
        trace: {
          stage: 'PAYOUT_REQUESTED',
          description: `Fake B2B payout request created for ${allocation.party}`,
          timestamp: new Date().toISOString(),
          amount: Number(allocation.amount ?? 0),
          currency: settlement.currency ?? 'UNKNOWN',
        },
      };
    });

    this.logger.log(`Ledger simulation triggered for ${settlement.reference} (${settlement.merchantTransactionReference})`);
    this.logger.log(`Callback state: ${callbackStatus}`);
    this.logger.log(`Allocation plan entries: ${JSON.stringify(allocationPlan.allocations ?? [])}`);
    payoutTransactions.forEach((txn: any) => {
      this.logger.log(`Payout simulation -> ${txn.party}: ${txn.amount} ${settlement.currency ?? 'UNKNOWN'} | status=${txn.status} | provider=${txn.provider} | ref=${txn.ledgerReference} | detail=${txn.details}`);
    });

    const timeline = [
      {
        stage: 'CALLBACK_RECEIVED',
        title: 'Payment callback accepted',
        status: 'COMPLETED',
        timestamp: callbackMetadata.paymentCallback?.receivedAt ?? startedAt,
        detail: `Callback for ${settlement.merchantTransactionReference} was accepted and validated.`,
      },
      {
        stage: 'ALLOCATION_CREATED',
        title: 'Ledger allocation plan prepared',
        status: 'COMPLETED',
        timestamp: startedAt,
        detail: `Allocation plan created for ${allocationPlan.allocations?.length ?? 0} payout instructions.`,
      },
      {
        stage: 'PAYOUT_REQUESTED',
        title: 'Payout requests sent to fake B2B gateway',
        status: 'COMPLETED',
        timestamp: new Date().toISOString(),
        detail: `Requested ${payoutTransactions.length} payout transactions through the fake B2B gateway.`,
      },
      {
        stage: 'PAYOUT_CALLBACK_PENDING',
        title: 'Waiting for fake B2B callback',
        status: 'PENDING',
        timestamp: new Date().toISOString(),
        detail: 'The payout service is awaiting the provider callback before marking the payables as paid.',
      },
      {
        stage: 'PAYOUT_VISIBLE',
        title: 'Payout visibility prepared',
        status: 'COMPLETED',
        timestamp: new Date().toISOString(),
        detail: 'Settlement now exposes the simulated payout state for downstream visibility and audit.',
      },
    ];

    const ledgerProcessingMetadata = {
      simulationStatus,
      startedAt,
      completedAt: new Date().toISOString(),
      payoutTransactions,
      callbackStatus,
      merchantTransactionReference: settlement.merchantTransactionReference,
      settlementReference: settlement.reference,
      summary: `Ledger processed ${payoutTransactions.length} payout instructions after callback confirmation.`,
      timeline,
      trace: {
        callback: {
          status: callbackStatus,
          reference: settlement.merchantTransactionReference,
          receivedAt: callbackMetadata.paymentCallback?.receivedAt ?? startedAt,
        },
        allocations: allocationPlan.allocations ?? [],
        payouts: payoutTransactions.map((txn: any) => ({
          party: txn.party,
          amount: txn.amount,
          status: txn.status,
          ledgerReference: txn.ledgerReference,
        })),
      },
      logs: [
        `Callback confirmed for ${settlement.merchantTransactionReference}`,
        `Allocation plan loaded with ${allocationPlan.allocations?.length ?? 0} entries`,
        `Simulated ${payoutTransactions.length} B2B payout transactions`,
        `Payout visibility prepared for ${settlement.merchantTransactionReference}`,
      ],
    };

    const persistedMetadata = {
      ...callbackMetadata,
      ledgerProcessing: ledgerProcessingMetadata,
      trace: {
        ...(callbackMetadata.trace ?? {}),
        ledger: ledgerProcessingMetadata,
      },
    };

    await this.repository.updateSettlementStatus(settlement.id, 'PROCESSING', {
      metadata: persistedMetadata,
    });

    return {
      success: true,
      status: 'PROCESSING',
      message: 'Ledger payout simulation completed after callback confirmation.',
      settlementId: settlement.id,
      settlementReference: settlement.reference,
      merchantTransactionReference: settlement.merchantTransactionReference,
      simulationResult: {
        simulationStatus,
        payoutTransactions,
        summary: ledgerProcessingMetadata.summary,
        timeline,
        trace: ledgerProcessingMetadata.trace,
        logs: ledgerProcessingMetadata.logs,
      },
    };
  }

  async processFakeB2bPayout(data: any): Promise<any> {
    const payoutReference = data.reference;
    const transactionId = `B2B-${Date.now()}`;
    const record: FakeB2bPayoutRecord = {
      transactionId,
      reference: payoutReference,
      settlementReference: data.settlementReference,
      merchantTransactionReference: data.merchantTransactionReference,
      status: 'PROCESSING',
      payload: data,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    this.fakeB2bPayouts.set(payoutReference, record);

    return {
      success: true,
      transactionId,
      reference: payoutReference,
      status: 'PROCESSING',
      message: 'Payout accepted by fake B2B gateway.',
      nextStep: 'Wait for the fake callback to mark the payout as successful or failed.',
    };
  }

  async handleFakeB2bCallback(data: any): Promise<any> {
    const payout = this.fakeB2bPayouts.get(data.reference);
    if (!payout) {
      throw new NotFoundException({ statusCode: 404, message: 'Payout reference not found in fake B2B gateway', error: 'PAYOUT_NOT_FOUND' });
    }

    payout.status = data.status === 'SUCCESS' ? 'SUCCESS' : 'FAILED';
    payout.providerReference = data.providerReference;
    payout.updatedAt = new Date().toISOString();

    this.fakeB2bPayouts.set(data.reference, payout);

    const settlement = await this.repository.findSettlementByReference(payout.merchantTransactionReference ?? payout.settlementReference ?? data.reference);
    if (settlement) {
      const existingMetadata = (settlement.metadata && typeof settlement.metadata === 'object') ? settlement.metadata as Record<string, any> : {};
      const allocationPlan = {
        ...(existingMetadata.allocationPlan ?? { allocations: [] }),
        allocations: Array.isArray(existingMetadata.allocationPlan?.allocations)
          ? existingMetadata.allocationPlan.allocations.map((allocation: any) => {
              if (allocation.destination === 'B2B payout' && allocation.status !== 'PAID') {
                return {
                  ...allocation,
                  status: payout.status === 'SUCCESS' ? 'PAID' : 'FAILED',
                  paidAt: payout.updatedAt,
                  payoutReference: data.reference,
                  payoutStatus: payout.status,
                };
              }
              return allocation;
            })
          : [],
      };
      const payoutTrace = {
        status: payout.status,
        transactionId: payout.transactionId,
        providerReference: payout.providerReference,
        completedAt: payout.updatedAt,
      };

      await this.repository.updateSettlementStatus(settlement.id, 'PROCESSING', {
        metadata: {
          ...existingMetadata,
          allocationPlan,
          payoutTrace,
          ledgerProcessing: {
            ...(existingMetadata.ledgerProcessing ?? {}),
            payoutTrace,
            finalStatus: payout.status,
          },
        },
      });
    }

    return {
      success: true,
      reference: data.reference,
      transactionId: payout.transactionId,
      status: payout.status,
      message: 'Fake B2B callback processed and payout status updated.',
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


  async onModuleDestroy() {
    await this.prisma.$disconnect();
  }
}
