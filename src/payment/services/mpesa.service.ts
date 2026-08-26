import { Prisma } from '@prisma/client';
import { randomUUID } from 'crypto';
import { getMpesaEnv, prisma, MPESA_PRODUCTION_ENDPOINTS } from '../config/mpesa.env';

export interface PaymentRequestLog {
  endpoint: string;
  method: string;
  path: string;
  requestBody: Record<string, unknown>;
  queryParams?: Record<string, unknown>;
  pathParams?: Record<string, unknown>;
}

export class MpesaService {
  private readonly logger = console;

  generateTimestamp(): string {
    return new Date().toISOString().replace(/[-:T.]/g, '').slice(0, 14);
  }

  buildPassword(shortcode: string, passkey: string, timestamp: string): string {
    return Buffer.from(`${shortcode}${passkey}${timestamp}`).toString('base64');
  }

  formatPhoneNumber(phoneNumber: string): string {
    const digits = String(phoneNumber ?? '').replace(/\D/g, '');
    if (!digits) return phoneNumber;
    if (digits.startsWith('0')) return `254${digits.slice(1)}`;
    if (digits.startsWith('+254')) return digits.replace('+', '');
    return digits;
  }

  private getBaseUrl(environment?: string): string {
    return environment === 'production' ? 'https://api.safaricom.co.ke' : 'https://sandbox.safaricom.co.ke';
  }

  private async logRequest(entry: PaymentRequestLog): Promise<void> {
    try {
      await prisma.mpesaRequestLog.create({
        data: {
          endpoint: entry.endpoint,
          method: entry.method,
          path: entry.path,
          requestBody: entry.requestBody as Prisma.InputJsonValue,
          queryParams: (entry.queryParams ?? Prisma.JsonNull) as Prisma.InputJsonValue,
          pathParams: (entry.pathParams ?? Prisma.JsonNull) as Prisma.InputJsonValue,
        },
      });
    } catch (error) {
      this.logger.warn(`[PAYMENT][LOG] failed to persist gateway request log: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  private async getAccessToken(): Promise<string> {
    const env = getMpesaEnv();
    const auth = Buffer.from(`${env.consumerKey}:${env.consumerSecret}`).toString('base64');
    const tokenUrl = `${this.getBaseUrl(env.environment)}/oauth/v1/generate?grant_type=client_credentials`;

    const response = await fetch(tokenUrl, {
      method: 'GET',
      headers: {
        Authorization: `Basic ${auth}`,
        Accept: 'application/json',
      },
    });

    const payload = await response.json().catch(() => ({}));
    const token = typeof payload === 'object' && payload !== null && typeof (payload as Record<string, unknown>).access_token === 'string'
      ? (payload as Record<string, unknown>).access_token as string
      : undefined;

    if (!response.ok || !token) {
      throw new Error(`M-Pesa authentication failed: ${JSON.stringify(payload)}`);
    }

    return token;
  }

  /**
   * Gets the endpoint path from Safaricom production/sandbox configuration
   * When MPESA_ENVIRONMENT=production, uses official Safaricom production endpoints
   * When MPESA_ENVIRONMENT=sandbox or development, uses sandbox endpoints
   */
  private getEndpointPath(endpoint: string, environment?: string): string {
    // Production endpoints from Safaricom official credentials email
    if (environment === 'production') {
      const productionEndpoints: Record<string, string> = {
        stk_push: MPESA_PRODUCTION_ENDPOINTS.stkPush,
        stk_query: MPESA_PRODUCTION_ENDPOINTS.stkPushQuery,
        b2c: MPESA_PRODUCTION_ENDPOINTS.b2c,
        b2b: MPESA_PRODUCTION_ENDPOINTS.b2b,
        b2pochi: '/mpesa/b2pochi/v1/paymentrequest',
        c2b_register: MPESA_PRODUCTION_ENDPOINTS.c2bV1,
        c2b_register_v2: MPESA_PRODUCTION_ENDPOINTS.c2bV2,
        c2b_simulate: MPESA_PRODUCTION_ENDPOINTS.c2bSimulate,
        reversal: MPESA_PRODUCTION_ENDPOINTS.reversal,
        transaction_status: MPESA_PRODUCTION_ENDPOINTS.transactionStatus,
        account_balance: MPESA_PRODUCTION_ENDPOINTS.accountBalance,
        qr_code: MPESA_PRODUCTION_ENDPOINTS.qrCode,
      };
      return productionEndpoints[endpoint] || '';
    }

    // Sandbox/Development endpoints
    const sandboxEndpoints: Record<string, string> = {
      stk_push: '/mpesa/stkpush/v1/processrequest',
      stk_query: '/mpesa/stkpushquery/v1/query',
      b2c: '/mpesa/b2c/v3/paymentrequest',
      b2b: '/mpesa/b2b/v1/paymentrequest',
      b2pochi: '/mpesa/b2pochi/v1/paymentrequest',
      c2b_register: '/mpesa/c2b/v1/registerurl',
      c2b_register_v2: '/mpesa/c2b/v1/registerurl', // Use v1 for sandbox
      c2b_simulate: '/mpesa/c2b/v1/simulate',
      reversal: '/mpesa/reversal/v1/request',
      transaction_status: '/mpesa/transactionstatus/v1/query',
      account_balance: '/mpesa/accountbalance/v1/query',
      qr_code: '/mpesa/qrcode/v1/generate',
    };
    return sandboxEndpoints[endpoint] || '';
  }

  async makeRequest(endpoint: string, payload: Record<string, unknown>): Promise<Record<string, unknown>> {
    const env = getMpesaEnv();
    const baseUrl = this.getBaseUrl(env.environment);
    const apiEndpoint = this.getEndpointPath(endpoint, env.environment);

    if (!apiEndpoint) {
      throw new Error(`Unsupported M-Pesa endpoint: ${endpoint}`);
    }

    const token = await this.getAccessToken();
    const url = `${baseUrl}${apiEndpoint}`;

    await this.logRequest({
      endpoint,
      method: 'POST',
      path: apiEndpoint,
      requestBody: payload,
    });

    const response = await fetch(url, {
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
      
      // Enhanced logging for error responses
      this.logger.error(`[PAYMENT][ERROR] endpoint=${endpoint} status=${response.status} statusText=${response.statusText}`, {
        httpStatus: response.status,
        statusText: response.statusText,
        errorResponse: data,
        url,
        environment: env.environment || 'not set (defaulting to sandbox)',
      });

      // Provide specific diagnostics for common errors
      if (response.status === 403) {
        this.logger.error(`[PAYMENT][403_FORBIDDEN] ${endpoint}`, {
          possibleCauses: [
            'Invalid or expired SecurityCredential',
            'Initiator not authorized for this transaction type',
            'IP address not whitelisted on M-Pesa account',
            'MPESA_ENVIRONMENT mismatch (sandbox creds on production or vice versa)',
            'ConsumerKey/ConsumerSecret invalid for environment',
          ],
          debugInfo: {
            consumerKeyLength: env.consumerKey?.length || 0,
            consumerSecretLength: env.consumerSecret?.length || 0,
            securityCredentialLength: (payload.SecurityCredential as string)?.length || 0,
          },
          timestamp: new Date().toISOString(),
        });
      }

      throw new Error(`M-Pesa ${endpoint} request failed: ${response.status} ${response.statusText} ${message}`);
    }

    return typeof data === 'object' && data !== null ? (data as Record<string, unknown>) : {};
  }

  async initiateStkPush(request: Record<string, any>): Promise<Record<string, unknown>> {
    const env = getMpesaEnv();
    const timestamp = this.generateTimestamp();
    const shortcode = env.shortcode || '174379';
    const passkey = env.passkey || '';
    const payerPhoneNumber = typeof request.payerPhoneNumber === 'string' ? request.payerPhoneNumber : typeof request.mobileNumber === 'string' ? request.mobileNumber : '';
    const formattedNumber = this.formatPhoneNumber(String(payerPhoneNumber || '').trim());
    const callbackToken = randomUUID();

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

    const callbackUrl = request.callbackUrl ?? `${(env.callbackUrl || `http://localhost:${process.env.PORT || '3000'}`).replace(/\/+$/, '')}/callbacks/mpesa/${callbackToken}`;
    const payload = {
      BusinessShortCode: shortcode,
      Password: this.buildPassword(shortcode, passkey, timestamp),
      Timestamp: timestamp,
      TransactionType: 'CustomerPayBillOnline',
      Amount: Math.round(Number(request.amount)),
      PartyA: formattedNumber,
      PartyB: shortcode,
      PhoneNumber: formattedNumber,
      CallBackURL: callbackUrl,
      AccountReference: request.accountReference || 'Payassure',
      TransactionDesc: request.transactionDesc || request.description || 'payment for goods',
    };

    try {
      const response = await this.makeRequest('stk_push', payload);
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

  async queryStkStatus(checkoutRequestId: string): Promise<Record<string, unknown>> {
    const env = getMpesaEnv();
    const timestamp = this.generateTimestamp();
    const shortcode = env.shortcode || '174379';
    const payload = {
      BusinessShortCode: shortcode,
      Password: this.buildPassword(shortcode, env.passkey || '', timestamp),
      Timestamp: timestamp,
      CheckoutRequestID: checkoutRequestId,
    };

    const response = await this.makeRequest('stk_query', payload);
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

  async dispatchB2bPayout(payload: Record<string, any>): Promise<Record<string, unknown>> {
    const env = getMpesaEnv();
    const timestamp = this.generateTimestamp();
    const shortcode = env.shortcode || '174379';
    const passkey = env.passkey || '';
    const request = {
      ...payload,
      BusinessShortCode: shortcode,
      Password: this.buildPassword(shortcode, passkey, timestamp),
      Timestamp: timestamp,
    };

    return this.makeRequest('b2b', request);
  }

  async dispatchB2PochiPayment(payload: Record<string, any>): Promise<Record<string, unknown>> {
    const request = {
      ...payload,
      CommandID: payload.CommandID || 'BusinessPayToPochi',
      Amount: String(payload.Amount ?? '0'),
      PartyB: Number(payload.PartyB ?? payload.partyB ?? payload.recipientPhone ?? 0),
    };

    const response = await this.makeRequest('b2pochi', request);
    return {
      originatorConversationId: response.OriginatorConversationID,
      conversationId: response.ConversationID,
      responseCode: response.ResponseCode,
      responseDescription: response.ResponseDescription,
      timestamp: new Date().toISOString(),
    };
  }

  async dispatchB2CPayment(payload: Record<string, any>): Promise<Record<string, unknown>> {
    const request = {
      ...payload,
      CommandID: payload.CommandID || 'BusinessPayment',
      Amount: String(payload.Amount ?? '0'),
      PartyA: String(payload.PartyA ?? payload.partyA ?? ''),
      PartyB: String(payload.PartyB ?? payload.partyB ?? payload.recipientPhone ?? ''),
    };

    const response = await this.makeRequest('b2c', request);
    return {
      originatorConversationId: response.OriginatorConversationID,
      conversationId: response.ConversationID,
      responseCode: response.ResponseCode,
      responseDescription: response.ResponseDescription,
      timestamp: new Date().toISOString(),
    };
  }
}

export const mpesaService = new MpesaService();
