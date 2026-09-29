import { Logger } from '@nestjs/common';
import { getMpesaCallbackUrl, getMpesaEnv } from '../config/mpesa.env';
import { generateSecurityCredential } from '../lib/mpesa-security-credential';
import { mpesaService, type MpesaRequestCredentials } from './mpesa.service';

export interface AccountBalanceRequestOptions {
  resultRoute?: string;
  timeoutRoute?: string;
  resultUrl?: string;
  timeoutUrl?: string;
  initiatorName?: string;
  initiatorPassword?: string;
  partyA?: string;
  identifierType?: string;
  remarks?: string;
  credentials?: MpesaRequestCredentials;
  requestLogLabel?: string;
}

class AccountBalanceService {
  private readonly logger = new Logger(AccountBalanceService.name);

  private resolveCallbackUrl(route?: string, fallback = '/account-balance'): string {
    const cleanedRoute = (route ?? fallback).trim();
    if (!cleanedRoute) return getMpesaCallbackUrl(fallback);
    if (/^https?:\/\//i.test(cleanedRoute)) return cleanedRoute;
    return getMpesaCallbackUrl(cleanedRoute.startsWith('/') ? cleanedRoute : `/${cleanedRoute}`);
  }

  async queryAccountBalance(options: AccountBalanceRequestOptions = {}): Promise<Record<string, unknown>> {
    const env = getMpesaEnv();
    const shortcode = env.shortcode || '174379';
    const partyA = options.partyA || env.partyA || shortcode;
    const payload = {
      Initiator: options.initiatorName || env.initiatorName || 'testapi',
      SecurityCredential: generateSecurityCredential(undefined, options.initiatorPassword ?? env.initiatorPassword),
      CommandID: 'AccountBalance',
      PartyA: partyA,
      IdentifierType: options.identifierType || '4',
      Remarks: options.remarks || 'Account balance query',
      QueueTimeOutURL: options.timeoutUrl || this.resolveCallbackUrl(options.timeoutRoute, '/account-balance'),
      ResultURL: options.resultUrl || this.resolveCallbackUrl(options.resultRoute, '/account-balance'),
    };

    if (options.requestLogLabel) {
      this.logger.log(options.requestLogLabel, {
        environment: options.credentials?.environment ?? env.environment,
        partyA,
        identifierType: payload.IdentifierType,
        resultUrl: payload.ResultURL,
        timeoutUrl: payload.QueueTimeOutURL,
      });
    }

    try {
      const response = await mpesaService.makeRequest('account_balance', payload, options.credentials);
      if (options.requestLogLabel) {
        this.logger.log(`${options.requestLogLabel} response`, {
          responseCode: response.responseCode ?? response.ResponseCode,
          originatorConversationId: response.originatorConversationId ?? response.OriginatorConversationID,
          conversationId: response.conversationId ?? response.ConversationID,
        });
      }
      return response;
    } catch (error) {
      if (options.requestLogLabel) {
        this.logger.error(`${options.requestLogLabel} error`, {
          environment: options.credentials?.environment ?? env.environment,
          partyA,
          error: error instanceof Error ? error.message : String(error),
        });
      }
      throw error;
    }
  }
}

export const accountBalanceService = new AccountBalanceService();
