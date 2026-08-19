import { Prisma, PrismaClient } from '@prisma/client';
import { randomUUID } from 'crypto';

export interface SharedMpesaEnv {
  MPESA_ENVIRONMENT?: string;
  MPESA_CONSUMER_KEY?: string;
  MPESA_CONSUMER_SECRET?: string;
  MPESA_SHORTCODE?: string;
  MPESA_PARTYA?: string;
  MPESA_PASSKEY?: string;
  MPESA_INITIATOR_NAME?: string;
  MPESA_INITIATOR_PASSWORD?: string;
  MPESA_SECURITY_CREDENTIAL?: string;
  MPESA_CALLBACK_URL?: string;
  PORT?: string;
}

export function getSharedMpesaEnv(): SharedMpesaEnv {
  return {
    MPESA_ENVIRONMENT: process.env.MPESA_ENVIRONMENT,
    MPESA_CONSUMER_KEY: process.env.MPESA_CONSUMER_KEY,
    MPESA_CONSUMER_SECRET: process.env.MPESA_CONSUMER_SECRET,
    MPESA_SHORTCODE: process.env.MPESA_SHORTCODE,
    MPESA_PARTYA: process.env.MPESA_PARTYA,
    MPESA_PASSKEY: process.env.MPESA_PASSKEY,
    MPESA_INITIATOR_NAME: process.env.MPESA_INITIATOR_NAME,
    MPESA_INITIATOR_PASSWORD: process.env.MPESA_INITIATOR_PASSWORD,
    MPESA_SECURITY_CREDENTIAL: process.env.MPESA_SECURITY_CREDENTIAL,
    MPESA_CALLBACK_URL: process.env.MPESA_CALLBACK_URL,
    PORT: process.env.PORT,
  };
}

export function generateTimestamp(): string {
  return new Date().toISOString().replace(/[-:T.]/g, '').slice(0, 14);
}

export function buildPassword(shortcode: string, passkey: string, timestamp: string): string {
  return Buffer.from(`${shortcode}${passkey}${timestamp}`).toString('base64');
}

export function formatPhoneNumber(input: string): string {
  const digits = String(input ?? '').replace(/\D/g, '');
  if (!digits) return input;
  if (digits.startsWith('0')) {
    return `254${digits.slice(1)}`;
  }
  if (digits.startsWith('+254')) {
    return digits.replace('+', '');
  }
  return digits;
}

export function buildStkPayload(options: {
  shortcode: string;
  passkey: string;
  timestamp: string;
  formattedNumber: string;
  amount: string | number;
  callbackUrl?: string;
  accountReference?: string;
  transactionDesc?: string;
}): Record<string, unknown> {
  const callbackUrl = options.callbackUrl ?? process.env.MPESA_CALLBACK_URL ?? 'http://localhost:3000/callbacks/mpesa';
  return {
    BusinessShortCode: options.shortcode,
    Password: buildPassword(options.shortcode, options.passkey, options.timestamp),
    Timestamp: options.timestamp,
    TransactionType: 'CustomerPayBillOnline',
    Amount: Math.round(Number(options.amount)),
    PartyA: options.formattedNumber,
    PartyB: options.shortcode,
    PhoneNumber: options.formattedNumber,
    CallBackURL: callbackUrl,
    AccountReference: options.accountReference || 'Payassure',
    TransactionDesc: options.transactionDesc || 'payment for goods',
  };
}

function getBaseUrl(environment?: string): string {
  return environment === 'production' ? 'https://api.safaricom.co.ke' : 'https://sandbox.safaricom.co.ke';
}

async function getAccessToken(env: SharedMpesaEnv): Promise<string> {
  const auth = Buffer.from(`${env.MPESA_CONSUMER_KEY}:${env.MPESA_CONSUMER_SECRET}`).toString('base64');
  const response = await fetch(`${getBaseUrl(env.MPESA_ENVIRONMENT)}/oauth/v1/generate?grant_type=client_credentials`, {
    method: 'GET',
    headers: {
      Authorization: `Basic ${auth}`,
      Accept: 'application/json',
    },
  });

  const data = await response.json().catch(() => ({}));
  const token = typeof data === 'object' && data !== null && typeof (data as Record<string, unknown>).access_token === 'string'
    ? (data as Record<string, unknown>).access_token as string
    : undefined;

  if (!response.ok || !token) {
    const message = typeof data === 'string' ? data : JSON.stringify(data);
    throw new Error(`M-Pesa authentication failed: ${message}`);
  }

  return token;
}

export async function makeMpesaRequest(env: SharedMpesaEnv, endpoint: string, payload: Record<string, unknown>): Promise<Record<string, unknown>> {
  const baseUrl = getBaseUrl(env.MPESA_ENVIRONMENT);
  const endpointMap: Record<string, string> = {
    stk_push: '/mpesa/stkpush/v1/processrequest',
    stk_query: '/mpesa/stkpushquery/v1/query',
    b2c: '/mpesa/b2c/v1/paymentrequest',
    b2b: '/mpesa/b2b/v1/paymentrequest',
    b2pochi: '/mpesa/b2pochi/v1/paymentrequest',
    c2b_register: '/mpesa/c2b/v1/registerurl',
    c2b_simulate: '/mpesa/c2b/v1/simulate',
    reversal: '/mpesa/reversal/v1/request',
  };

  const apiEndpoint = endpointMap[endpoint];
  if (!apiEndpoint) {
    throw new Error(`Unsupported M-Pesa endpoint: ${endpoint}`);
  }

  if (!env.MPESA_CONSUMER_KEY || !env.MPESA_CONSUMER_SECRET || !env.MPESA_SHORTCODE || !env.MPESA_PASSKEY) {
    throw new Error(`M-Pesa ${endpoint} request cannot be sent without full credentials`);
  }

  const token = await getAccessToken(env);
  const response = await fetch(`${baseUrl}${apiEndpoint}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = typeof data === 'string' ? data : JSON.stringify(data);
    throw new Error(`M-Pesa ${endpoint} request failed: ${response.status} ${response.statusText} ${message}`);
  }

  return typeof data === 'object' && data !== null ? (data as Record<string, unknown>) : {};
}

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

  const callbackUrl = request.callbackUrl ?? `${(env.MPESA_CALLBACK_URL || `http://localhost:${env.PORT || '3000'}`).replace(/\/+$/, '')}/callbacks/mpesa/${callbackToken}`;
  const payload = buildStkPayload({
    shortcode,
    passkey,
    timestamp,
    formattedNumber,
    amount: request.amount,
    callbackUrl,
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
