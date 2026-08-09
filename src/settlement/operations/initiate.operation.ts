import { BadRequestException, ConflictException, ForbiddenException, InternalServerErrorException, UnauthorizedException } from '@nestjs/common';
import { ParticipantStatus, ParticipantType, SettlementStatus } from '@prisma/client';
import { request as httpsRequest } from 'https';
import { request as httpRequest } from 'http';
import { InitiateSettlementDto } from '../dto/initiate-settlement.dto';
import { validateAndGetSession } from '../helpers/session.helpers';
import { validateSettlementData } from '../helpers/validation.helpers';
import { generateInternalMerchantTransactionReference, generatePayAssureReference } from '../helpers/reference.helpers';

const GATEWAY_STK_PATH = '/api/payments/mpesa/stk';

function getGatewayBaseUrl() {
  const gatewayBaseUrl = process.env.GATEWAY_BASE_URL;
  if (!gatewayBaseUrl) {
    throw new InternalServerErrorException({
      statusCode: 500,
      message: 'Payment gateway base URL is not configured',
      error: 'GATEWAY_BASE_URL_MISSING',
    });
  }
  return gatewayBaseUrl.replace(/\/+$/, '');
}

function getGatewayAccountReference() {
  const accountReference = process.env.GATEWAY_ACCOUNT_REFERENCE;
  if (!accountReference) {
    throw new InternalServerErrorException({
      statusCode: 500,
      message: 'Payment gateway account reference is not configured',
      error: 'GATEWAY_ACCOUNT_REFERENCE_MISSING',
    });
  }
  return accountReference;
}

function buildTransactionDescription(data: InitiateSettlementDto) {
  const isGoods = Array.isArray(data.suppliers) && data.suppliers.some((supplier) => Array.isArray(supplier.items) && supplier.items.length > 0);
  return isGoods ? 'Goods payment' : 'Settlement payment';
}

async function sendStkPushRequest(payload: Record<string, any>) {
  const gatewayBaseUrl = getGatewayBaseUrl();
  const url = new URL(GATEWAY_STK_PATH, gatewayBaseUrl);
  const body = JSON.stringify(payload);
  const clientRequest = url.protocol === 'http:' ? httpRequest : httpsRequest;

  return new Promise<any>((resolve, reject) => {
    const req = clientRequest(
      url,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(body),
        },
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (chunk) => chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)));
        res.on('end', () => {
          const raw = Buffer.concat(chunks).toString('utf8');
          const statusCode = res.statusCode ?? 0;
          if (statusCode < 200 || statusCode >= 300) {
            return reject(new Error(`Gateway returned ${statusCode}: ${raw}`));
          }
          try {
            const parsed = raw ? JSON.parse(raw) : {};
            resolve(parsed);
          } catch (error) {
            reject(new Error(`Invalid gateway response: ${error instanceof Error ? error.message : String(error)}`));
          }
        });
      },
    );

    req.setTimeout(50000, () => {
      req.destroy(new Error('Gateway request timed out after 5000ms'));
    });
    req.on('error', (err) => reject(err));
    req.write(body);
    req.end();
  });
}

function shouldRetryGatewayError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  const normalized = message.toLowerCase();
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

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
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

  logger.error?.(`Gateway delivery failed after ${maxAttempts} attempts for merchantTransactionReference=${merchantTransactionReference}`);
  return {
    success: false,
    message: `Gateway delivery failed after ${maxAttempts} attempts`,
    error: lastError?.message ?? 'Unknown gateway error',
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
      payerPhoneNumber: payment.payerPhoneNumber ?? undefined,
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
  logger.log(`Initiate settlement requested: session=${token}, merchantTransactionReference=${data.merchantTransactionReference}`);
  const session = await validateAndGetSession(token, repository, logger);
  const integration = await repository.findIntegrationById(session.integrationId);
  const businessId = (session as any).businessId ?? (session as any).business?.id ?? integration?.participantId ?? integration?.participant?.id ?? 'unknown';
  const integrationId = (session as any).integrationId ?? (session as any).integration?.id ?? integration?.id ?? 'unknown';
  logger.log(`Settlement session validated for business=${businessId}, integration=${integrationId}`);
  if (!integration || !integration.participant) {
    logger.warn(`Invalid session context: session=${token}, integrationId=${session.integrationId}`);
    throw new UnauthorizedException({ statusCode: 401, message: 'Invalid session or retailer context', error: 'INVALID_SESSION' });
  }

  const retailerMerchantId = integration.merchantId;
  logger.log(`Authenticated retailer merchantId=${retailerMerchantId}, participant=${integration.participant.id}`);

  if (integration.participant.participantType !== ParticipantType.RETAILER || !([ParticipantStatus.ACTIVE, ParticipantStatus.LIVE] as ParticipantStatus[]).includes(integration.participant.status)) {
    logger.warn(`Retailer not authorized or inactive: merchantId=${retailerMerchantId}, status=${integration.participant.status}`);
    throw new ForbiddenException({ statusCode: 403, message: 'Retailer account is not authorized to initiate settlements', error: 'RETAILER_NOT_AUTHORIZED' });
  }

  try {
    logger.log(`Checking for existing settlement for business=${businessId}, reference=${data.merchantTransactionReference}`);
    const existingSettlement = await repository.findSettlementByBusinessAndPayloadReference(businessId, data.merchantTransactionReference);
    if (existingSettlement) {
      logger.log(`Existing settlement found for reference=${data.merchantTransactionReference}, settlementId=${existingSettlement.id}`);
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

    logger.log(`No existing settlement found, validating request payload for merchantTransactionReference=${data.merchantTransactionReference}`);
    await validateSettlementData(data, repository, logger, supportedCurrencies);
    logger.log(`Payload validation passed for merchantTransactionReference=${data.merchantTransactionReference}`);

    const payAssureReference = generatePayAssureReference();
    const internalMerchantTransactionReference = generateInternalMerchantTransactionReference();
    logger.log(`Creating primary settlement with payAssureReference=${payAssureReference}, internalReference=${internalMerchantTransactionReference}`);
    const primarySettlement = await repository.createSettlement(businessId, integrationId, payAssureReference, internalMerchantTransactionReference, data);

    if (data.paymentMethod?.type?.toUpperCase() === 'MPESA') {
      const mobileNumber = data.paymentMethod.payerPhoneNumber;
      const amount = Number(data.totalAmount);
      const accountReference = getGatewayAccountReference();
      const transactionDesc = buildTransactionDescription(data);
      const gatewayRequestPayload = {
        merchantTransactionReference: data.merchantTransactionReference,
        totalAmount: amount,
        currency: data.currency,
        settlementMethod: data.settlementMethod,
        description: data.description,
        paymentMethod: data.paymentMethod,
        transactionDate: data.transactionDate,
        metadata: data.metadata,
        suppliers: data.suppliers,
        mobileNumber,
        amount,
        accountReference,
        transactionDesc,
      };

      logger.log(`Sending STK push request to payment gateway for merchantTransactionReference=${data.merchantTransactionReference}`);
      logger.log(`Gateway request payload: ${JSON.stringify(gatewayRequestPayload)}`);
      const gatewayResult = await sendStkPushRequestWithRetry(
        async (payload) => sendStkPushRequest({ ...gatewayRequestPayload, ...payload }),
        logger,
        data.merchantTransactionReference,
        3,
        1000,
      );

      if (!gatewayResult.success) {
        logger.warn(`Gateway delivery failed after retries for merchantTransactionReference=${data.merchantTransactionReference}`);
        if (typeof repository.updateSettlementStatus === 'function') {
          await repository.updateSettlementStatus(primarySettlement.id, SettlementStatus.INITIATED, {
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
              gatewayPending: true,
              gatewayPendingReason: gatewayResult.error ?? 'Gateway unavailable',
            },
          });
        } else {
          logger.warn('Repository does not implement updateSettlementStatus; skipping persistence of gateway failure metadata');
        }
        if (typeof repository.touchSession === 'function') {
          await repository.touchSession(session.id);
        }
        return {
          success: false,
          settlement: {
            settlementId: primarySettlement.id,
            merchantId: retailerMerchantId,
            status: SettlementStatus.INITIATED,
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
          message: 'Gateway delivery failed after retries. Settlement is pending gateway retry.',
        };
      }

      logger.log(`STK push gateway response received for merchantTransactionReference=${data.merchantTransactionReference}`);

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

    await repository.touchSession(session.id);
    logger.log(`Session touched (lastUsedAt updated) for sessionId=${session.id}`);

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

    for (const supplier of data.suppliers) {
      logger.log(`Processing supplier ${supplier.supplierMerchantId} for settlement ${primarySettlement.id}`);
      const supplierItems = Array.isArray(supplier.items) ? supplier.items : [];
      const hasItems = supplierItems.length > 0;
      const supplierAmount = hasItems ? supplierItems.reduce((sum: number, item: any) => sum + Number(item.supplierAmount ?? 0), 0) : Number(supplier.supplierTotalAmount ?? 0);
      const retailerAmount = Number(supplier.retailerTotalAmount ?? 0);
      const platformFee = Number(supplier.platformFee ?? 0);
      totalSupplierAmount += supplierAmount;
      totalRetailerAmount += retailerAmount;
      totalSystemAmount += platformFee;

      logger.log(`Supplier ${supplier.supplierMerchantId} amount=${supplierAmount}, retailerAmount=${retailerAmount}, platformFee=${platformFee}, itemCount=${hasItems ? supplierItems.length : 0}`);
      const supplierMerchantTransactionReference = `${internalMerchantTransactionReference}-${supplier.supplierMerchantId}`;

      const supplierIntegration = await prisma.integration.findFirst({ where: { merchantId: supplier.supplierMerchantId, isActive: true }, include: { participant: true } });
      const paymentSnapshot = supplierIntegration?.participant?.payment ?? null;
      const supplierPaymentDetails = toPublicPaymentDetails(paymentSnapshot);

      const settlement = await repository.createSupplierSettlement(session.businessId, session.integrationId, {
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

      logger.log(`Created supplier settlement ${settlement.id} for supplier ${supplier.supplierMerchantId}`);
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
    };
  } catch (error) {
    if (error instanceof BadRequestException || error instanceof ConflictException || error instanceof ForbiddenException) {
      throw error;
    }

    const err = error as Error;
    logger.error(`Settlement initiation failed: ${err.message ?? 'Unknown error'} | context=${JSON.stringify({ requestBody: data, settlementSessionToken: token })}`, err.stack);
    logger.log(`Settlement initiation flow ended with error for merchantTransactionReference=${data.merchantTransactionReference}`);
    throw new InternalServerErrorException({ statusCode: 500, message: 'An error occurred while initiating settlement. Please check logs for details.', error: 'INITIATION_FAILED' });
  }
}
