import { BadGatewayException, BadRequestException, ConflictException, ForbiddenException, InternalServerErrorException, UnauthorizedException } from '@nestjs/common';
import { ParticipantStatus, ParticipantType, SettlementStatus } from '@prisma/client';
import { InitiateSettlementDto } from '../dto/initiate-settlement.dto';
import { validateAndGetSession } from '../helpers/session.helpers';
import { validateSettlementData } from '../helpers/validation.helpers';
import { generateInternalMerchantTransactionReference, generatePayAssureReference } from '../helpers/reference.helpers';
import { mpesaService } from '../../payment/services/mpesa.service';
import { b2pochiService } from '../../payment/services/b2pochi.service';
import { MockBankEscrowProvider } from '../../escrow-intelligence/providers/mock-bank-escrow.provider';

const GATEWAY_REQUEST_TIMEOUT_MS = 15000;

function getGatewayAccountReference() {
  const accountReference = process.env.GATEWAY_ACCOUNT_REFERENCE || process.env.MPESA_ACCOUNT_REFERENCE || 'payassure';
  return accountReference;
}

function buildTransactionDescription(data: InitiateSettlementDto) {
  const isGoods = Array.isArray(data.suppliers) && data.suppliers.some((supplier) => Array.isArray(supplier.items) && supplier.items.length > 0);
  return isGoods ? 'Goods payment' : 'Settlement payment';
}

function aggregateSuppliers(suppliers: InitiateSettlementDto['suppliers']) {
  const grouped = new Map<string, any>();

  for (const supplier of suppliers ?? []) {
    const existing = grouped.get(supplier.supplierMerchantId);
    const items = Array.isArray(supplier.items) ? supplier.items : [];
    if (!existing) {
      grouped.set(supplier.supplierMerchantId, {
        ...supplier,
        supplierTotalAmount: Number(supplier.supplierTotalAmount ?? 0),
        retailerTotalAmount: Number(supplier.retailerTotalAmount ?? 0),
        platformFee: Number(supplier.platformFee ?? 0),
        items: [...items],
      });
      continue;
    }

    existing.supplierTotalAmount += Number(supplier.supplierTotalAmount ?? 0);
    existing.retailerTotalAmount += Number(supplier.retailerTotalAmount ?? 0);
    existing.platformFee += Number(supplier.platformFee ?? 0);
    existing.items.push(...items);
  }

  return Array.from(grouped.values());
}

async function sendStkPushRequest(payload: Record<string, any>) {
  return mpesaService.initiateStkPush(payload);
}

function shouldRetryGatewayError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  const normalized = message.toLowerCase();
  const statusMatch = normalized.match(/gateway returned (\d{3})/);
  const statusCode = statusMatch ? Number(statusMatch[1]) : undefined;

  if (normalized.includes(`gateway request timed out after ${GATEWAY_REQUEST_TIMEOUT_MS}ms`)) {
    return false;
  }

  if (statusCode !== undefined) {
    return [408, 429, 500, 502, 503, 504].includes(statusCode);
  }

  return [
    'econnreset',
    'econnrefused',
    'etimedout',
    'enetunreach',
    'socket hang up',
    'aggregateerror',
    'fetch failed',
    'timed out',
    'getaddrinfo',
    'network',
  ].some((token) => normalized.includes(token));
}

export async function sendStkPushRequestWithRetry(
  sender: (payload: Record<string, any>) => Promise<any>,
  logger: Pick<any, 'log' | 'warn' | 'error'>,
  merchantTransactionReference: string,
  maxAttempts = 3,
  baseDelayMs = 1000,
) {
  let lastError: Error | undefined;
  let attemptsMade = 0;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    attemptsMade = attempt;
    try {
      const response = await sender({});
      return { success: true, response };
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
      const shouldRetry = shouldRetryGatewayError(lastError) && attempt < maxAttempts;
      logger.warn?.(`Gateway attempt ${attempt}/${maxAttempts} failed for merchantTransactionReference=${merchantTransactionReference}: ${lastError.message}`);
      if (!shouldRetry) {
        break;
      }
      const delayMs = Math.min(baseDelayMs * 2 ** (attempt - 1), 4000);
      if (delayMs > 0) {
        logger.warn?.(`Waiting ${delayMs}ms before retry ${attempt + 1}/${maxAttempts} for merchantTransactionReference=${merchantTransactionReference}`);
        await new Promise((resolve) => setTimeout(resolve, delayMs));
      }
    }
  }

  const retryable = lastError ? shouldRetryGatewayError(lastError) : false;
  logger.error?.(`Gateway delivery failed after ${attemptsMade} attempt${attemptsMade === 1 ? '' : 's'} for merchantTransactionReference=${merchantTransactionReference}`);
  return {
    success: false,
    message: `Gateway delivery failed after ${attemptsMade} attempt${attemptsMade === 1 ? '' : 's'}`,
    error: lastError?.message ?? 'Unknown gateway error',
    retryable,
    attempts: attemptsMade,
  };
}

function normalizePaymentMethods(data: InitiateSettlementDto) {
  const explicitMethods = Array.isArray(data.paymentMethods) && data.paymentMethods.length > 0
    ? data.paymentMethods
    : [];

  if (explicitMethods.length > 0) {
    return explicitMethods.map((payment) => ({
      type: payment.type,
      amount: Number(payment.amount ?? 0),
      provider: payment.provider,
      payerPhoneNumber: payment.payerPhoneNumber ?? payment.phoneNumber ?? '',
      phoneNumber: payment.phoneNumber ?? payment.payerPhoneNumber ?? '',
    }));
  }

  if (!data.paymentMethod) {
    return [];
  }

  return [{
    type: data.paymentMethod.type,
    amount: Number(data.paymentMethod.amount ?? data.totalAmount ?? 0),
    provider: data.paymentMethod.provider,
    payerPhoneNumber: data.paymentMethod.payerPhoneNumber ?? data.paymentMethod.phoneNumber ?? '',
    phoneNumber: data.paymentMethod.phoneNumber ?? data.paymentMethod.payerPhoneNumber ?? '',
  }];
}

function toPublicPaymentDetails(payment: any) {
  if (!payment || !payment.type) {
    return undefined;
  }

  const base: any = {
    type: payment.type,
    accountName: payment.accountName ?? undefined,
    provider: payment.provider ?? undefined,
  };

  if (payment.type === 'MPESA') {
    return {
      ...base,
      phoneNumber: payment.phoneNumber ?? payment.payerPhoneNumber ?? undefined,
    };
  }

  if (payment.type === 'BANK') {
    return {
      ...base,
      bankCode: payment.bankCode ?? undefined,
      accountNumber: payment.accountNumber ?? undefined,
      shortcode: payment.shortcode ?? undefined,
    };
  }

  return base;
}

export function normalizeSettlementError(error: unknown, fallbackContext?: Record<string, any>) {
  const message = error instanceof Error ? error.message : String(error ?? 'Unknown settlement error');
  const isGatewayFailure = /(fetch failed|M-Pesa|B2Pochi|gateway.*failed|ECONN|ENET|timed out|timeout|403|securitycredential)/i.test(message);

  if (isGatewayFailure) {
    return {
      statusCode: 502,
      message,
      error: 'PAYMENT_PROVIDER_ERROR',
      provider: 'M-PESA/B2POCHI',
      details: {
        code: 'UPSTREAM_GATEWAY_FAILURE',
        ...fallbackContext,
        troubleshooting: [
          'Check the MPESA_ENVIRONMENT and credentials match the active account',
          'Verify the initiator is authorized for B2Pochi transactions',
          'Regenerate the security credential if it has expired',
          'Check IP whitelisting and public callback accessibility',
          'Confirm the M-Pesa gateway is reachable from this environment',
        ],
      },
    };
  }

  return {
    statusCode: 500,
    message,
    error: 'INITIATION_FAILED',
    details: {
      code: 'SETTLEMENT_INITIATION_FAILED',
      ...fallbackContext,
    },
  };
}

export async function initiateOperation(
  prisma: any,
  repository: any,
  logger: any,
  token: string,
  data: InitiateSettlementDto,
  supportedCurrencies: string[],
) {
  const session = await validateAndGetSession(token, repository, logger);
  const integration = await repository.findIntegrationById(session.integrationId);
  const businessId = (session as any).businessId ?? (session as any).business?.id ?? integration?.participantId ?? integration?.participant?.id ?? 'unknown';
  const integrationId = (session as any).integrationId ?? (session as any).integration?.id ?? integration?.id ?? 'unknown';
  if (!integration || !integration.participant) {
    logger.warn(`Invalid session context: session=${token}, integrationId=${session.integrationId}`);
    throw new UnauthorizedException({ statusCode: 401, message: 'Invalid session or retailer context', error: 'INVALID_SESSION' });
  }

  const retailerMerchantId = integration.merchantId;

  if (integration.participant.participantType !== ParticipantType.RETAILER || !([ParticipantStatus.ACTIVE, ParticipantStatus.LIVE] as ParticipantStatus[]).includes(integration.participant.status)) {
    logger.warn(`Retailer not authorized or inactive: merchantId=${retailerMerchantId}, status=${integration.participant.status}`);
    throw new ForbiddenException({ statusCode: 403, message: 'Retailer account is not authorized to initiate settlements', error: 'RETAILER_NOT_AUTHORIZED' });
  }

  try {
    const existingSettlement = await repository.findSettlementByBusinessAndPayloadReference(businessId, data.merchantTransactionReference);
    if (existingSettlement) {
      await repository.touchSession(session.id);
      const existingTransactions = Array.isArray(existingSettlement.transactions)
        ? existingSettlement.transactions.map((txn: any) => ({
            transactionId: txn.id,
            itemId: txn.itemId,
            type: txn.type,
            amount: Number(txn.amount),
            description: txn.description ?? undefined,
            status: txn.status,
          }))
        : [];

      const retailerAmount = existingSettlement.retailerAmount ?? 0;
      const supplierAmount = existingSettlement.supplierAmount ?? Number(existingSettlement.amount);
      const systemAmount = existingSettlement.systemAmount ?? 0;
      const paymentDetails = toPublicPaymentDetails(data.paymentMethod);

      return {
        success: true,
        settlement: {
          settlementId: existingSettlement.id,
          merchantId: retailerMerchantId,
          status: existingSettlement.status,
          amount: Number(existingSettlement.amount),
          retailerAmount,
          supplierAmount,
          systemAmount,
          paymentDetails,
          currency: existingSettlement.currency,
          reference: existingSettlement.reference,
          createdAt: existingSettlement.createdAt,
          estimatedProcessingTime: '10 minutes',
          transactions: existingTransactions,
        },
        message: 'Settlement already processed for this merchant transaction reference',
      };
    }

    const validationResult = await validateSettlementData(data, repository, logger, supportedCurrencies);
    const invalidSupplierIndexes = new Set(validationResult.invalidSuppliers.map((supplier) => supplier.index));
    const invalidSuppliers = validationResult.invalidSuppliers.map((supplier) => ({
      supplierMerchantId: supplier.supplierMerchantId,
      errors: supplier.errors,
    }));

    if (invalidSupplierIndexes.size > 0) {
      const eligibleSuppliers = data.suppliers.filter((_supplier, index) => !invalidSupplierIndexes.has(index));
      if (eligibleSuppliers.length === 0) {
        throw new BadRequestException({
          statusCode: 400,
          message: 'No eligible suppliers remain for settlement',
          error: 'NO_ELIGIBLE_SUPPLIERS',
          invalidSuppliers,
        });
      }

      data.suppliers = eligibleSuppliers;
      data.totalAmount = data.suppliers.reduce((total, supplier) => {
        const items = Array.isArray(supplier.items) ? supplier.items : [];
        const supplierAmount = items.length > 0
          ? items.reduce((sum, item) => sum + Number(item.supplierAmount ?? 0), 0)
          : Number(supplier.supplierTotalAmount ?? 0);
        return total + supplierAmount + Number(supplier.retailerTotalAmount ?? 0) + Number(supplier.platformFee ?? 0);
      }, 0);
      data.metadata = {
        ...(data.metadata ?? {}),
        excludedSuppliers: invalidSuppliers,
      };
      logger.warn(`Excluded ${invalidSuppliers.length} invalid supplier allocation(s) from settlement`, { invalidSuppliers });
    }

    data.suppliers = aggregateSuppliers(data.suppliers) as any;

    const payAssureReference = generatePayAssureReference();
    const internalMerchantTransactionReference = generateInternalMerchantTransactionReference();
    const primarySettlement = await repository.createSettlement(businessId, integrationId, payAssureReference, internalMerchantTransactionReference, data);

    const initiateCustomerPayment = async () => {
      const settlementFundingMethods = normalizePaymentMethods(data);
      const providerName = String(data.paymentMethod?.provider ?? data.paymentMethod?.type ?? 'MPESA').trim().toUpperCase();

      if (settlementFundingMethods.length > 0 && settlementFundingMethods.some((method) => ['CASH', 'ESCROW'].includes(String(method.type ?? '').trim().toUpperCase()))) {
        const escrowCustomerId = retailerMerchantId || businessId;
        const cashAmount = settlementFundingMethods
          .filter((method) => String(method.type ?? '').trim().toUpperCase() === 'CASH')
          .reduce((sum, method) => sum + Number(method.amount ?? 0), 0);
        const mpesaAmount = settlementFundingMethods
          .filter((method) => String(method.type ?? '').trim().toUpperCase() === 'MPESA')
          .reduce((sum, method) => sum + Number(method.amount ?? 0), 0);
        const retailerOutstandingBalance = Number(data.totalAmount ?? 0) - ((data.suppliers ?? []).reduce((sum, supplier) => sum + Number((Array.isArray(supplier.items) ? supplier.items : []).reduce((itemTotal, item) => itemTotal + Number(item.supplierAmount ?? 0), 0) || Number(supplier.supplierTotalAmount ?? 0)), 0)) - Number((data.suppliers ?? []).reduce((sum, supplier) => sum + Number(supplier.platformFee ?? 0), 0));

        const fundingSummary = {
          businessId,
          integrationId,
          retailerMerchantId,
          escrowCustomerId,
          merchantTransactionReference: data.merchantTransactionReference,
          totalAmount: Number(data.totalAmount ?? 0),
          fundingMethods: settlementFundingMethods,
          cashAmount,
          mpesaAmount,
          retailerOutstandingBalance,
          supplierCount: data.suppliers?.length ?? 0,
          transactionDate: data.transactionDate,
        };

        logger.warn('[CASH_FLOW][MULTI_FUNDING_SUMMARY]', fundingSummary);

        const escrowBalanceBefore = await new MockBankEscrowProvider().getCustomerEscrowBalance(escrowCustomerId);
        if (cashAmount > 0 && escrowBalanceBefore.balance < cashAmount) {
          const insufficientFundsMessage = `Insufficient retailer escrow balance. Available: ${escrowBalanceBefore.balance} KES. Required: ${cashAmount} KES. Deposit funds into the escrow account before retrying the settlement.`;
          logger.warn('[CASH_FLOW][ESCROW_INSUFFICIENT_FUNDS]', {
            customerId: escrowCustomerId,
            currentBalance: escrowBalanceBefore.balance,
            requiredAmount: cashAmount,
            message: insufficientFundsMessage,
          });
          await repository.updateSettlementStatus(primarySettlement.id, SettlementStatus.FAILED, {
            metadata: {
              ...(data.metadata ?? {}),
              paymentGateway: { provider: 'CASH', status: 'BLOCKED', reason: insufficientFundsMessage },
            },
            failedAt: new Date(),
          });
          return {
            success: false,
            settlement: {
              settlementId: primarySettlement.id,
              merchantId: retailerMerchantId,
              status: SettlementStatus.FAILED,
              amount: Number(data.totalAmount),
              retailerAmount: 0,
              supplierAmount: Number(data.totalAmount),
              systemAmount: 0,
              paymentDetails: toPublicPaymentDetails(data.paymentMethod),
              currency: data.currency,
              reference: primarySettlement.reference,
              createdAt: primarySettlement.createdAt,
              estimatedProcessingTime: 'N/A',
            },
            message: insufficientFundsMessage,
          };
        }

        if (cashAmount > 0) {
          const cashRequest = {
            businessId,
            integrationId,
            retailerMerchantId,
            escrowCustomerId,
            merchantTransactionReference: data.merchantTransactionReference,
            totalAmount: Number(data.totalAmount ?? 0),
            supplierCount: data.suppliers?.length ?? 0,
            provider: 'ESCROW',
            paymentMethod: { ...data.paymentMethod, provider: 'ESCROW' },
            transactionDate: data.transactionDate,
            suppliers: data.suppliers,
            cashAmount,
          };

        logger.warn('[CASH_FLOW][START]', cashRequest);
        logger.log('[CASH_FLOW][DETAILS]', {
          paymentMethod: data.paymentMethod,
          totalAmount: Number(data.totalAmount ?? 0),
          supplierSummary: (data.suppliers ?? []).map((supplier) => ({
            supplierMerchantId: supplier.supplierMerchantId,
            supplierTotalAmount: Number(supplier.supplierTotalAmount ?? 0),
            retailerTotalAmount: Number(supplier.retailerTotalAmount ?? 0),
            platformFee: Number(supplier.platformFee ?? 0),
            itemCount: Array.isArray(supplier.items) ? supplier.items.length : 0,
          })),
        });

        const mockBankProvider = new MockBankEscrowProvider({
          [escrowCustomerId]: {
            balance: Number(data.totalAmount ?? 0),
            transactions: [{
              id: `cash-${Date.now()}`,
              customerId: escrowCustomerId,
              date: new Date(data.transactionDate).toISOString().slice(0, 10),
              type: 'CREDIT',
              amount: Number(data.totalAmount ?? 0),
              description: 'Cash collection recorded into retailer escrow',
            }],
          },
        });

        const escrowBalanceBefore = await mockBankProvider.getCustomerEscrowBalance(escrowCustomerId);
        const supplierAmountTotal = Number((data.suppliers ?? []).reduce((sum, supplier) => sum + Number((Array.isArray(supplier.items) ? supplier.items : []).reduce((itemTotal, item) => itemTotal + Number(item.supplierAmount ?? 0), 0) || Number(supplier.supplierTotalAmount ?? 0)), 0));
        const platformFeeTotal = Number((data.suppliers ?? []).reduce((sum, supplier) => sum + Number(supplier.platformFee ?? 0), 0));
        const expectedEscrowBalance = cashAmount > 0 ? cashAmount : Number(data.totalAmount ?? 0);
        const escrowMatchesExpectation = escrowBalanceBefore.balance === expectedEscrowBalance || escrowBalanceBefore.balance >= expectedEscrowBalance;

        logger.log('[CASH_FLOW][ESCROW_QUERY]', {
          customerId: escrowCustomerId,
          queriedBank: 'MockBankEscrowProvider',
          currentBalance: escrowBalanceBefore.balance,
          currency: escrowBalanceBefore.currency,
          expectedEscrowBalance,
          matchesEscrowExpectation: escrowMatchesExpectation,
          message: escrowMatchesExpectation
            ? 'Queried escrow bank and this is inline with the escrow expectation before settlement.'
            : 'Queried escrow bank and the balance does not align with the expected settlement amount.',
        });

        if (escrowBalanceBefore.balance < expectedEscrowBalance) {
          const insufficientFundsMessage = `Insufficient retailer escrow balance. Available: ${escrowBalanceBefore.balance} KES. Required: ${expectedEscrowBalance} KES. Deposit funds into the escrow account before retrying the settlement.`;
          logger.warn('[CASH_FLOW][ESCROW_INSUFFICIENT_FUNDS]', {
            customerId: escrowCustomerId,
            currentBalance: escrowBalanceBefore.balance,
            requiredAmount: expectedEscrowBalance,
            message: insufficientFundsMessage,
          });
          await repository.updateSettlementStatus(primarySettlement.id, SettlementStatus.FAILED, {
            metadata: {
              ...(data.metadata ?? {}),
              paymentGateway: { provider: 'CASH', status: 'BLOCKED', reason: insufficientFundsMessage },
            },
            failedAt: new Date(),
          });
          return {
            success: false,
            settlement: {
              settlementId: primarySettlement.id,
              merchantId: retailerMerchantId,
              status: SettlementStatus.FAILED,
              amount: Number(data.totalAmount),
              retailerAmount: 0,
              supplierAmount: Number(data.totalAmount),
              systemAmount: 0,
              paymentDetails: toPublicPaymentDetails(data.paymentMethod),
              currency: data.currency,
              reference: primarySettlement.reference,
              createdAt: primarySettlement.createdAt,
              estimatedProcessingTime: 'N/A',
            },
            message: insufficientFundsMessage,
          };
        }

        logger.log('[CASH_FLOW][ESCROW_SIMULATION_REQUEST]', {
          customerId: escrowCustomerId,
          amount: Number(data.totalAmount ?? 0),
          cashAmount,
          mpesaAmount,
          provider: 'ESCROW',
          scenario: 'cash-collection',
          supplierAmount: supplierAmountTotal,
          platformFee: platformFeeTotal,
          retailerOutstandingBalance,
          retailerEscrowBalance: expectedEscrowBalance,
        });

        const cashCollection = await mockBankProvider.simulateCollection({
          customerId: escrowCustomerId,
          amount: cashAmount > 0 ? cashAmount : Number(data.totalAmount ?? 0),
          provider: 'CASH',
          scenario: 'cash-collection',
          supplierAmount: supplierAmountTotal,
          platformFee: platformFeeTotal,
          retailerEscrowBalance: expectedEscrowBalance,
        });

        logger.log('[CASH_FLOW][ESCROW_COLLECTION_SUCCESS]', {
          status: cashCollection.status,
          message: cashCollection.message,
          priorBalance: expectedEscrowBalance,
          expectedNewBalance: cashCollection.actualBalance,
          collectedAmount: cashCollection.collectedAmount,
          provider: cashCollection.provider,
          auditLogId: cashCollection.auditLogId,
          note: 'Funds were collected from the retailer escrow and the remaining expected balance is now reflected in the bank ledger.',
        });

        if (cashCollection.status !== 'SUCCESS') {
          logger.warn(`[CASH_COLLECTION][BLOCKED] ${cashCollection.message}`);
          logger.warn('[CASH_FLOW][BLOCKED]', {
            businessId,
            merchantTransactionReference: data.merchantTransactionReference,
            reason: cashCollection.message,
            provider: 'CASH',
            collectionResult: cashCollection,
          });
          await repository.updateSettlementStatus(primarySettlement.id, SettlementStatus.FAILED, {
            metadata: {
              ...(data.metadata ?? {}),
              cashCollection,
              paymentGateway: { provider: 'CASH', status: 'BLOCKED', reason: cashCollection.message },
            },
            failedAt: new Date(),
          });
          return {
            success: false,
            settlement: {
              settlementId: primarySettlement.id,
              merchantId: retailerMerchantId,
              status: SettlementStatus.FAILED,
              amount: Number(data.totalAmount),
              retailerAmount: 0,
              supplierAmount: Number(data.totalAmount),
              systemAmount: 0,
              paymentDetails: toPublicPaymentDetails(data.paymentMethod),
              currency: data.currency,
              reference: primarySettlement.reference,
              createdAt: primarySettlement.createdAt,
              estimatedProcessingTime: 'N/A',
            },
            message: cashCollection.message,
          };
        }

        data.metadata = {
          ...(data.metadata ?? {}),
          paymentGateway: {
            provider: 'CASH',
            status: 'COLLECTED_FROM_ESCROW',
            collection: cashCollection,
          },
        };

        logger.log('[CASH_FLOW][PAYASSURE_DEPOSIT]', {
          settlementId: primarySettlement.id,
          merchantTransactionReference: data.merchantTransactionReference,
          provider: 'CASH',
          collectedAmount: Number(cashCollection.collectedAmount ?? 0),
          status: cashCollection.status,
          message: 'Cash funds have been collected successfully and deposited to PayAssure for settlement orchestration.',
        });

        const mpesaFundingResults: any[] = [];
        if (mpesaAmount > 0) {
          logger.warn('[CASH_FLOW][MPESA_FUNDING_WAITING_FOR_LANDING]', {
            merchantTransactionReference: data.merchantTransactionReference,
            amount: mpesaAmount,
            message: 'Waiting for MPESA funds to land to the PayAssure account before supplier payouts are released.',
          });

          const mpesaFundingMethod = settlementFundingMethods.find((method) => String(method.type ?? '').trim().toUpperCase() === 'MPESA');
          const mpesaPayerPhoneNumber = String(
            mpesaFundingMethod?.payerPhoneNumber ?? mpesaFundingMethod?.phoneNumber ?? data.paymentMethod?.payerPhoneNumber ?? data.paymentMethod?.phoneNumber ?? ''
          ).trim();

          const mpesaFundingRequest = {
            merchantTransactionReference: data.merchantTransactionReference,
            totalAmount: mpesaAmount,
            currency: data.currency,
            paymentMethod: {
              type: 'MPESA',
              provider: mpesaFundingMethod?.provider ?? 'MPESA',
              payerPhoneNumber: mpesaPayerPhoneNumber,
            },
            payerPhoneNumber: mpesaPayerPhoneNumber,
            mobileNumber: mpesaPayerPhoneNumber,
            amount: mpesaAmount,
            accountReference: getGatewayAccountReference(),
            transactionDesc: buildTransactionDescription(data),
            description: `MPESA funding allocation for mixed settlement ${data.merchantTransactionReference}`,
          };

          const mpesaResult = await sendStkPushRequestWithRetry(
            async () => sendStkPushRequest({
              ...mpesaFundingRequest,
              gatewayPayload: mpesaFundingRequest,
            }),
            logger,
            data.merchantTransactionReference,
          );

          mpesaFundingResults.push({
            type: 'MPESA',
            amount: mpesaAmount,
            result: mpesaResult,
            message: 'MPESA funding has landed and is now available for the retailer balance and payout orchestration.',
          });

          if (!mpesaResult.success) {
            const refundResult = cashAmount > 0 ? await mockBankProvider.refundCollection({
              customerId: escrowCustomerId,
              amount: cashAmount,
              provider: 'CASH',
              scenario: 'cash-refund',
              description: 'Refund escrow funds after MPESA funding failure for mixed settlement',
            }) : null;

            logger.warn('[CASH_FLOW][MPESA_FUNDING_BLOCKED]', {
              merchantTransactionReference: data.merchantTransactionReference,
              amount: mpesaAmount,
              result: mpesaResult,
              escrowRefund: refundResult,
            });
            return {
              success: false,
              settlement: {
                settlementId: primarySettlement.id,
                merchantId: retailerMerchantId,
                status: SettlementStatus.FAILED,
                amount: Number(data.totalAmount),
                retailerAmount: 0,
                supplierAmount: Number(data.totalAmount),
                systemAmount: 0,
                paymentDetails: toPublicPaymentDetails(data.paymentMethod),
                currency: data.currency,
                reference: primarySettlement.reference,
                createdAt: primarySettlement.createdAt,
                estimatedProcessingTime: 'N/A',
              },
              message: `Mixed payment settlement is blocked because MPESA funding did not land successfully: ${mpesaResult.error ?? mpesaResult.message ?? 'Unknown MPESA funding error'}`,
            };
          }
        }

        if (cashAmount > 0 && mpesaAmount > 0) {
          data.metadata = {
            ...(data.metadata ?? {}),
            paymentGateway: {
              provider: 'CASH',
              status: 'WAITING_FOR_MPESA_CALLBACK',
              collection: cashCollection,
              mpesaInitiated: mpesaFundingResults[0] ?? null,
              message: 'Escrow funds were collected and the MPESA request was initiated. Supplier payouts remain paused until the payment callback confirms both funding legs have landed.',
            },
          };

          logger.warn('[CASH_FLOW][AWAITING_MPESA_CALLBACK]', {
            settlementId: primarySettlement.id,
            merchantTransactionReference: data.merchantTransactionReference,
            cashAmount,
            mpesaAmount,
            status: 'WAITING_FOR_MPESA_CALLBACK',
            message: 'Escrow collection succeeded and MPESA funding was initiated. Supplier payouts will only dispatch after the callback confirms funds have landed in the PayAssure account.',
          });

          await repository.updateSettlementStatus(primarySettlement.id, SettlementStatus.PENDING_PROCESSING, {
            metadata: {
              ...(data.metadata ?? {}),
              paymentGateway: {
                provider: 'CASH',
                status: 'WAITING_FOR_MPESA_CALLBACK',
                collection: cashCollection,
                mpesaInitiated: mpesaFundingResults[0] ?? null,
                message: 'Escrow funds were collected and the MPESA request was initiated. Supplier payouts remain paused until payment confirmation is received.',
              },
            },
          });

          return {
            success: true,
            settlement: {
              settlementId: primarySettlement.id,
              merchantId: retailerMerchantId,
              status: SettlementStatus.PENDING_PROCESSING,
              amount: Number(data.totalAmount),
              retailerAmount: 0,
              supplierAmount: Number(data.totalAmount),
              systemAmount: 0,
              paymentDetails: toPublicPaymentDetails(data.paymentMethod),
              currency: data.currency,
              reference: primarySettlement.reference,
              createdAt: primarySettlement.createdAt,
              estimatedProcessingTime: 'Awaiting MPESA callback confirmation',
            },
            message: 'Cash escrow collection succeeded and MPESA funding was initiated. Supplier payouts are paused until the payment callback confirms the funds have landed in PayAssure.',
            cashCollection,
            mpesaInitiated: mpesaFundingResults[0] ?? null,
          };
        }

        const supplierPayouts = [] as Array<Record<string, any>>;
        for (const supplier of data.suppliers) {
          const supplierItems = Array.isArray(supplier.items) ? supplier.items : [];
          const supplierAmount = supplierItems.length > 0
            ? supplierItems.reduce((sum, item) => sum + Number(item.supplierAmount ?? 0), 0)
            : Number(supplier.supplierTotalAmount ?? 0);
          const supplierIntegration = await prisma.integration.findFirst({ where: { merchantId: supplier.supplierMerchantId, isActive: true }, include: { participant: true } });
          const supplierPayment = supplierIntegration?.participant?.payment as any;
          const supplierPhone = supplierPayment?.phoneNumber ?? supplierPayment?.payerPhoneNumber ?? null;

          logger.log('[CASH_FLOW][SUPPLIER_PAYOUT_PREP]', {
            supplierMerchantId: supplier.supplierMerchantId,
            supplierAmount,
            supplierPhonePresent: Boolean(supplierPhone),
            itemCount: supplierItems.length,
            platformFee: Number(supplier.platformFee ?? 0),
            retailerAmount: Number(supplier.retailerTotalAmount ?? 0),
          });

          if (supplierPhone) {
            const payoutRequest = {
              Amount: String(Math.round(Number(supplierAmount))),
              PartyB: supplierPhone,
              Remarks: `Supplier payout for ${supplier.supplierMerchantId}`,
              callbackUrl: process.env.MPESA_CALLBACK_URL || 'http://localhost:3000/callbacks/mpesa',
              merchantTransactionReference: data.merchantTransactionReference,
              supplierMerchantId: supplier.supplierMerchantId,
            };
            logger.log('[CASH_FLOW][SUPPLIER_PAYOUT_REQUEST]', payoutRequest);
            const payoutResult = await b2pochiService.initiateB2Pochi(payoutRequest);
            logger.log('[CASH_FLOW][SUPPLIER_PAYOUT_RESULT]', {
              supplierMerchantId: supplier.supplierMerchantId,
              supplierAmount,
              payoutResult,
              message: 'Supplier payout has been dispatched from the collected cash pool.',
            });
            supplierPayouts.push({ supplierMerchantId: supplier.supplierMerchantId, supplierAmount, payoutResult });
          } else {
            logger.warn('[CASH_FLOW][SUPPLIER_PAYOUT_SKIPPED]', {
              supplierMerchantId: supplier.supplierMerchantId,
              reason: 'No supplier phone was found for payout dispatch',
              supplierAmount,
            });
          }
        }

        logger.log('[CASH_FLOW][FINAL_SUMMARY]', {
          settlementId: primarySettlement.id,
          merchantTransactionReference: data.merchantTransactionReference,
          businessId,
          manufacturer: 'cash-provider-logging',
          provider: 'CASH',
          totalAmount: Number(data.totalAmount ?? 0),
          payoutCount: supplierPayouts.length,
          collectionStatus: cashCollection.status,
          supplierPayouts,
          message: 'Cash settlement flow completed: escrow checked, funds collected, deposited to PayAssure, and supplier dispatch initiated.',
        });

        data.metadata = {
          ...(data.metadata ?? {}),
          paymentGateway: {
            provider: 'CASH',
            status: 'COLLECTED_FROM_ESCROW',
            collection: cashCollection,
            supplierPayouts,
          },
        };

        return {
          success: true,
          settlement: {
            settlementId: primarySettlement.id,
            merchantId: retailerMerchantId,
            status: SettlementStatus.PENDING_PROCESSING,
            amount: Number(data.totalAmount),
            retailerAmount: 0,
            supplierAmount: Number(data.totalAmount),
            systemAmount: 0,
            paymentDetails: toPublicPaymentDetails(data.paymentMethod),
            currency: data.currency,
            reference: primarySettlement.reference,
            createdAt: primarySettlement.createdAt,
            estimatedProcessingTime: 'N/A',
          },
          message: 'Cash collection succeeded from retailer escrow and supplier payout requests were dispatched.',
          cashCollection,
          supplierPayouts,
        };
      }
      }

      if (data.paymentMethod?.type?.toUpperCase() === 'MPESA') {
      const mobileNumber = String(data.paymentMethod.payerPhoneNumber ?? '').trim();
      const amount = Number(data.totalAmount);
      const accountReference = getGatewayAccountReference();
      const transactionDesc = buildTransactionDescription(data);
      const gatewayRequestPayload = {
        merchantTransactionReference: data.merchantTransactionReference,
        totalAmount: amount,
        currency: data.currency,
        settlementMethod: data.settlementMethod,
        description: data.description,
        paymentMethod: {
          ...data.paymentMethod,
          payerPhoneNumber: mobileNumber,
          phoneNumber: undefined,
        },
        transactionDate: data.transactionDate,
        metadata: data.metadata,
        suppliers: data.suppliers,
        mobileNumber,
        payerPhoneNumber: mobileNumber,
        amount,
        accountReference,
        transactionDesc,
      };

      logger.log('[PAYMENT_DISPATCH_PAYLOAD]', gatewayRequestPayload);
      const gatewayResult = await sendStkPushRequestWithRetry(
        async (payload) => sendStkPushRequest({ gatewayPayload: gatewayRequestPayload, ...gatewayRequestPayload, ...payload }),
        logger,
        data.merchantTransactionReference,
        3,
        1000,
      );

      if (!gatewayResult.success) {
        const retryable = Boolean(gatewayResult.retryable);
        logger.warn(`STK push delivery failed after retries for merchantTransactionReference=${data.merchantTransactionReference}. retryable=${retryable}`);
        if (typeof repository.updateSettlementStatus === 'function') {
          await repository.updateSettlementStatus(primarySettlement.id, retryable ? SettlementStatus.INITIATED : SettlementStatus.FAILED, {
            metadata: {
              ...(data.metadata ?? {}),
              paymentGateway: {
                request: {
                  ...gatewayRequestPayload,
                  mobileNumber,
                  amount,
                  accountReference,
                  transactionDesc,
                },
                response: gatewayResult,
              },
              gatewayPending: retryable,
              gatewayPendingReason: gatewayResult.error ?? 'Payment service unavailable',
            },
            failedAt: retryable ? undefined : new Date(),
          });
        } else {
          logger.warn('Repository does not implement updateSettlementStatus; skipping persistence of payment failure metadata');
        }
        if (typeof repository.touchSession === 'function') {
          await repository.touchSession(session.id);
        }
        return {
          success: false,
          settlement: {
            settlementId: primarySettlement.id,
            merchantId: retailerMerchantId,
            status: retryable ? SettlementStatus.INITIATED : SettlementStatus.FAILED,
            amount: Number(data.totalAmount),
            retailerAmount: 0,
            supplierAmount: Number(data.totalAmount),
            systemAmount: 0,
            paymentDetails: toPublicPaymentDetails(data.paymentMethod),
            currency: data.currency,
            reference: primarySettlement.reference,
            createdAt: primarySettlement.createdAt,
            estimatedProcessingTime: 'N/A',
          },
          message: retryable
            ? 'STK push initiation failed after retries. Settlement is marked for retryable failure.'
            : 'STK push initiation failed after retries with non-retryable error. Settlement is marked failed.',
        };
      }

      data.metadata = {
        ...(data.metadata ?? {}),
        paymentGateway: {
          request: {
            ...gatewayRequestPayload,
            mobileNumber,
            amount,
            accountReference,
            transactionDesc,
          },
          response: gatewayResult.response,
        },
      };
      }
    };

    await repository.touchSession(session.id);

    const childSettlements: Array<{
      id: string;
      reference: string;
      supplier: { amount: number; paymentDetails?: any };
      retailer: { amount: number; paymentDetails?: any };
      systemAmount: number;
      amount: number;
    }> = [];
    let totalSupplierAmount = 0;
    let totalRetailerAmount = 0;
    let totalSystemAmount = 0;
    const supplierAmountSummary: Array<{ supplierMerchantId?: string; supplierAmount: number; retailerAmount: number; platformFee: number }> = [];

    for (const [supplierIndex, supplier] of data.suppliers.entries()) {
      const supplierItems = Array.isArray(supplier.items) ? supplier.items : [];
      const hasItems = supplierItems.length > 0;
      const supplierAmount = hasItems ? supplierItems.reduce((sum: number, item: any) => sum + Number(item.supplierAmount ?? 0), 0) : Number(supplier.supplierTotalAmount ?? 0);
      const retailerAmount = Number(supplier.retailerTotalAmount ?? 0);
      const platformFee = Number(supplier.platformFee ?? 0);
      totalSupplierAmount += supplierAmount;
      totalRetailerAmount += retailerAmount;
      totalSystemAmount += platformFee;

      supplierAmountSummary.push({ supplierMerchantId: supplier.supplierMerchantId, supplierAmount, retailerAmount, platformFee });
      const supplierMerchantTransactionReference = `${internalMerchantTransactionReference}-${supplier.supplierMerchantId}-${supplierIndex}`;

      const supplierIntegration = await prisma.integration.findFirst({ where: { merchantId: supplier.supplierMerchantId, isActive: true }, include: { participant: true } });
      const paymentSnapshot = supplierIntegration?.participant?.payment ?? null;
      const supplierPaymentDetails = toPublicPaymentDetails(paymentSnapshot);

      const settlement = await repository.createSupplierSettlement(session.businessId, session.integrationId, {
        amount: supplierAmount,
        currency: data.currency,
        settlementMethod: data.settlementMethod,
        reference: `${data.merchantTransactionReference}-${supplier.supplierMerchantId}-${supplierIndex}`,
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
        paymentPayload: {
          paymentMethod: data.paymentMethod,
          suppliers: [{
            supplierMerchantId: supplier.supplierMerchantId,
            supplierTotalAmount: supplierAmount,
            retailerTotalAmount: retailerAmount,
            platformFee,
            items: hasItems ? supplierItems.map((item: any) => ({
              itemReference: item.itemReference ?? item.itemId,
              supplierAmount: item.supplierAmount,
            })) : [],
          }],
        },
      });

      const transactionItems = hasItems
        ? supplierItems.map((item: any) => ({
            itemId: item.itemReference ?? item.itemId ?? 'supplier-summary',
            supplierMerchantId: supplier.supplierMerchantId,
            type: 'SALE',
            amount: Number(item.supplierAmount ?? 0),
          }))
        : [{
            itemId: `${supplier.supplierMerchantId}-summary`,
            supplierMerchantId: supplier.supplierMerchantId,
            type: 'SALE',
            amount: supplierAmount,
          }];

      await repository.createMultipleTransactions(settlement.id, transactionItems);

      childSettlements.push({
        id: settlement.id,
        reference: settlement.reference,
        supplier: {
          amount: supplierAmount,
          paymentDetails: supplierPaymentDetails,
        },
        retailer: {
          amount: retailerAmount,
          paymentDetails: toPublicPaymentDetails(data.paymentMethod),
        },
        systemAmount: platformFee,
        amount: supplierAmount + retailerAmount + platformFee,
      });
    }

    logger.log('[SUPPLIER_SETTLEMENT_AMOUNTS]', supplierAmountSummary);

    const deferredPaymentResult = await initiateCustomerPayment();
    if (deferredPaymentResult) {
      return deferredPaymentResult;
    }

    const requestPaymentDetails = toPublicPaymentDetails(data.paymentMethod);

    return {
      success: true,
      settlement: {
        settlementId: primarySettlement.id,
        merchantId: retailerMerchantId,
        status: primarySettlement.status,
        amount: Number(primarySettlement.amount),
        retailerAmount: totalRetailerAmount,
        supplierAmount: totalSupplierAmount,
        systemAmount: totalSystemAmount,
        paymentDetails: requestPaymentDetails,
        currency: primarySettlement.currency,
        reference: primarySettlement.reference,
        createdAt: primarySettlement.createdAt,
        estimatedProcessingTime: '24-48 hours',
      },
      message: 'Settlement request received and queued for processing',
      children: childSettlements,
      ...(invalidSuppliers.length > 0 ? { excludedSuppliers: invalidSuppliers } : {}),
    };
  } catch (error) {
    if (error instanceof BadRequestException || error instanceof ConflictException || error instanceof ForbiddenException) {
      throw error;
    }

    const err = error as Error;
    const context = {
      requestBody: data,
      settlementSessionToken: token,
    };
    const normalized = normalizeSettlementError(err, { provider: 'M-PESA/B2POCHI', context });

    logger.error(`Settlement initiation failed: ${normalized.message} | context=${JSON.stringify(context)}`, err.stack);

    if (normalized.statusCode === 502) {
      throw new BadGatewayException({
        statusCode: 502,
        message: normalized.message,
        error: normalized.error,
        provider: normalized.provider,
        details: normalized.details,
      });
    }

    throw new InternalServerErrorException({
      statusCode: 500,
      message: normalized.message,
      error: normalized.error,
      details: normalized.details,
    });
  }
}
