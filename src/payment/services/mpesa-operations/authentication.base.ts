import { Prisma } from '@prisma/client';
import { prisma } from '../../../common/database/prisma';
import { getMpesaEnv } from '../../config/mpesa.env';
import type { MpesaRequestCredentials, PaymentRequestLog } from './types';
import { MpesaEnvironmentBase } from './environment.base';
import { sanitizeMpesaResponsePayload } from './request-logging';

export abstract class MpesaAuthenticationBase extends MpesaEnvironmentBase {
  protected async logRequest(entry: PaymentRequestLog): Promise<void> {
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

  protected async getAccessToken(
    credentials?: MpesaRequestCredentials,
    operation?: string,
    requestPayload?: Record<string, unknown>,
  ): Promise<string> {
    const env = getMpesaEnv();
    const consumerKey = credentials?.consumerKey ?? env.consumerKey;
    const consumerSecret = credentials?.consumerSecret ?? env.consumerSecret;
    const environment = credentials?.environment ?? env.environment;
    const auth = Buffer.from(`${consumerKey}:${consumerSecret}`).toString('base64');
    const tokenUrl = `${this.getBaseUrl(environment)}/oauth/v1/generate?grant_type=client_credentials`;
    const response = await fetch(tokenUrl, {
      method: 'GET',
      headers: { Authorization: `Basic ${auth}`, Accept: 'application/json' },
    });
    const responseBody = await response.text();
    let payload: unknown;
    try {
      payload = responseBody ? JSON.parse(responseBody) : {};
    } catch {
      payload = responseBody || '(empty response body)';
    }
    const accessToken = typeof payload === 'object' && payload !== null && typeof (payload as Record<string, unknown>).access_token === 'string'
      ? (payload as Record<string, unknown>).access_token as string
      : undefined;
    const token = accessToken?.trim();
    if (!response.ok || !token) {
      const safePayload = sanitizeMpesaResponsePayload(payload);
      const details = typeof safePayload === 'string' ? safePayload : JSON.stringify(safePayload);
      this.logger.error('[PAYMENT][AUTHENTICATION_ERROR] M-Pesa OAuth token request failed', {
        operation,
        httpStatus: response.status,
        statusText: response.statusText,
        tokenUrl,
        environment: environment || 'not set (defaulting to sandbox)',
        request: {
          method: 'GET',
          queryParams: { grant_type: 'client_credentials' },
          headers: { Accept: 'application/json', Authorization: 'Basic [REDACTED]' },
          credentialsSource: credentials ? 'request-specific credentials' : 'MPESA_* environment variables',
          consumerKeyConfigured: Boolean(consumerKey),
          consumerKeyLength: consumerKey?.length ?? 0,
          consumerSecretConfigured: Boolean(consumerSecret),
          consumerSecretLength: consumerSecret?.length ?? 0,
        },
        apiRequestPayload: requestPayload,
        responseBody: safePayload,
      });
      throw new Error(`M-Pesa authentication failed: HTTP ${response.status} ${response.statusText}; ${details}`);
    }
    console.log('[PAYMENT][AUTHENTICATION] M-Pesa OAuth token acquired', {
      operation,
      tokenUrl,
      environment: environment || 'not set (defaulting to sandbox)',
      credentialsSource: credentials ? 'request-specific credentials' : 'MPESA_* environment variables',
      consumerKeyConfigured: Boolean(consumerKey),
      consumerKeyLength: consumerKey?.length ?? 0,
      tokenReceived: true,
      tokenLength: token.length,
    });
    return token;
  }
}
