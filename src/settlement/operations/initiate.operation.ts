import { BadRequestException, ConflictException, ForbiddenException, InternalServerErrorException, UnauthorizedException } from '@nestjs/common';
import { ParticipantStatus, ParticipantType, SettlementStatus } from '@prisma/client';
import { InitiateSettlementDto } from '../dto/initiate-settlement.dto';
import { validateAndGetSession } from '../helpers/session.helpers';
import { validateSettlementData } from '../helpers/validation.helpers';
import { generateInternalMerchantTransactionReference, generatePayAssureReference } from '../helpers/reference.helpers';
import { mpesaService } from '../../payment/services/mpesa.service';

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
    logger.error(`Settlement initiation failed: ${err.message ?? 'Unknown error'} | context=${JSON.stringify({ requestBody: data, settlementSessionToken: token })}`, err.stack);
    throw new InternalServerErrorException({ statusCode: 500, message: 'An error occurred while initiating settlement. Please check logs for details.', error: 'INITIATION_FAILED' });
  }
}
