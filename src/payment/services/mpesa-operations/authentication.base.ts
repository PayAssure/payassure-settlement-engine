import { Prisma } from '@prisma/client';
import { prisma } from '../../../common/database/prisma';
import { getMpesaEnv } from '../../config/mpesa.env';
import type { MpesaRequestCredentials, PaymentRequestLog } from './types';
import { MpesaEnvironmentBase } from './environment.base';

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

  protected async getAccessToken(credentials?: MpesaRequestCredentials): Promise<string> {
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
    const payload = await response.json().catch(() => ({}));
    const token = typeof payload === 'object' && payload !== null && typeof (payload as Record<string, unknown>).access_token === 'string'
      ? (payload as Record<string, unknown>).access_token as string
      : undefined;
    if (!response.ok || !token) {
      throw new Error(`M-Pesa authentication failed: ${JSON.stringify(payload)}`);
    }
    return token;
  }
}
