import { Prisma, PrismaClient } from '@prisma/client';
import { randomUUID } from 'crypto';
import { buildPassword, generateTimestamp, getSharedMpesaEnv } from './environment';
import { formatPhoneNumber } from './phone-number';
import { makeMpesaRequest } from './client';
import { buildStkPayload } from './stk-payload';

export async function initiateMpesaStkPush(request: Record<string, any>): Promise<Record<string, unknown>> {
  const env = getSharedMpesaEnv();
  const timestamp = generateTimestamp();
  const shortcode = env.MPESA_SHORTCODE || '174379';
  const passkey = env.MPESA_PASSKEY || '';
  const formattedNumber = formatPhoneNumber(String(request.payerPhoneNumber ?? request.mobileNumber ?? ''));
  const callbackToken = randomUUID();

  const prisma = new PrismaClient();
  const record = await prisma.mpesaTransaction.create({
    data: {
      callbackToken,
      amount: Number(request.amount ?? 0),
      status: 'PENDING',
      businessShortCode: shortcode,
      accountReference: request.accountReference ?? null,
      phoneNumber: formattedNumber,
      settlementId: request.settlementId ?? null,
      merchantTransactionReference: request.merchantTransactionReference ?? null,
      gatewayPayloadJson: request.gatewayPayload ?? null,
      processingLogs: ['STK push initiated', 'waiting for callback'],
    },
  });

  const callbackUrl = `${(env.MPESA_CALLBACK_URL || `http://localhost:${env.PORT || '3000'}`).replace(/\/+$/, '')}/callbacks/mpesa/${callbackToken}`;
  const payload = buildStkPayload({
    shortcode,
    passkey,
    timestamp,
    formattedNumber,
    amount: request.amount,
    accountReference: request.accountReference ?? 'Payassure',
    transactionDesc: request.transactionDesc || request.description || 'payment for goods',
  });

  try {
    const response = await makeMpesaRequest(env, 'stk_push', payload);
    const responseCode = typeof response.ResponseCode === 'string' ? response.ResponseCode : String(response.ResponseCode ?? '');
    const responseDescription = typeof response.ResponseDescription === 'string' ? response.ResponseDescription : undefined;

    await prisma.mpesaTransaction.update({
      where: { id: record.id },
      data: {
        merchantRequestId: typeof response.MerchantRequestID === 'string' ? response.MerchantRequestID : null,
        checkoutRequestId: typeof response.CheckoutRequestID === 'string' ? response.CheckoutRequestID : null,
        resultCode: Number(response.ResponseCode ?? -1),
        resultDescription: responseDescription ?? null,
        customerMessage: typeof response.CustomerMessage === 'string' ? response.CustomerMessage : null,
        requestBody: payload as Prisma.InputJsonValue,
        status: responseCode === '0' ? 'PENDING' : 'FAILED',
      },
    });

    return {
      merchantRequestId: response.MerchantRequestID,
      checkoutRequestId: response.CheckoutRequestID,
      responseCode: response.ResponseCode,
      responseDescription: response.ResponseDescription,
      customerMessage: response.CustomerMessage,
      timestamp: new Date().toISOString(),
    };
  } catch (error) {
    const failureReason = error instanceof Error ? error.message : String(error);
    await prisma.mpesaTransaction.update({
      where: { id: record.id },
      data: {
        status: 'FAILED',
        resultDescription: failureReason,
        pushFailureReason: failureReason,
      },
    });
    throw error;
  }
}

export async function queryMpesaStkStatus(checkoutRequestId: string): Promise<Record<string, unknown>> {
  const env = getSharedMpesaEnv();
  const timestamp = generateTimestamp();
  const shortcode = env.MPESA_SHORTCODE || '174379';
  const passkey = env.MPESA_PASSKEY || '';
  const payload = {
    BusinessShortCode: shortcode,
    Password: buildPassword(shortcode, passkey, timestamp),
    Timestamp: timestamp,
    CheckoutRequestID: checkoutRequestId,
  };

  const response = await makeMpesaRequest(env, 'stk_query', payload);
  return {
    merchantRequestId: response.MerchantRequestID,
    checkoutRequestId: response.CheckoutRequestID,
    responseCode: response.ResponseCode,
    responseDescription: response.ResponseDescription,
    resultCode: response.ResultCode,
    resultDesc: response.ResultDesc,
    timestamp: new Date().toISOString(),
  };
}

export async function dispatchMpesaB2bPayout(payload: Record<string, any>): Promise<Record<string, unknown>> {
  const env = getSharedMpesaEnv();
  return makeMpesaRequest(env, 'b2b', payload as Record<string, unknown>);
}
