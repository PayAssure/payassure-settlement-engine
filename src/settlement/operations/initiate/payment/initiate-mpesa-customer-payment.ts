import { SettlementStatus } from '@prisma/client';
import type { SettlementInitiationContext } from '../context';
import { buildTransactionDescription } from './build-transaction-description';
import { getGatewayAccountReference } from './get-gateway-account-reference';
import { sendStkPushRequest, sendStkPushRequestWithRetry } from './stk-push-with-retry';
import { buildSettlementResult } from '../helpers/build-settlement-result';

export async function initiateMpesaCustomerPayment(context: SettlementInitiationContext) {
  const { data, repository, logger, session, primarySettlement, retailerMerchantId } = context;
  const mobileNumber = String(data.paymentMethod?.payerPhoneNumber ?? '').trim();
  const amount = Number(data.totalAmount);
  const accountReference = getGatewayAccountReference();
  const transactionDesc = buildTransactionDescription(data);
  const gatewayRequestPayload = {
    merchantTransactionReference: data.merchantTransactionReference,
    totalAmount: amount,
    currency: data.currency,
    settlementMethod: data.settlementMethod,
    description: data.description,
    paymentMethod: { ...data.paymentMethod, payerPhoneNumber: mobileNumber, phoneNumber: undefined },
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
            request: { ...gatewayRequestPayload, mobileNumber, amount, accountReference, transactionDesc },
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
    if (typeof repository.touchSession === 'function') await repository.touchSession(session.id);
    return {
      success: false,
      settlement: buildSettlementResult(context, {
        status: retryable ? SettlementStatus.INITIATED : SettlementStatus.FAILED,
        estimatedProcessingTime: 'N/A',
      }),
      message: retryable
        ? 'STK push initiation failed after retries. Settlement is marked for retryable failure.'
        : 'STK push initiation failed after retries with non-retryable error. Settlement is marked failed.',
    };
  }

  data.metadata = {
    ...(data.metadata ?? {}),
    paymentGateway: {
      request: { ...gatewayRequestPayload, mobileNumber, amount, accountReference, transactionDesc },
      response: gatewayResult.response,
    },
  };
  return undefined;
}