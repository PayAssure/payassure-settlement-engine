import { InternalServerErrorException, ServiceUnavailableException } from '@nestjs/common';
import { createSign } from 'crypto';
import { EquityBankConfigBase } from './config.base';
import type { EquityBankConfig } from './types';

export abstract class EquityBankAuthorizationBase extends EquityBankConfigBase {
  protected async getAuthorization(config: EquityBankConfig): Promise<string> {
    if (!config.apiKey || !config.merchantCode || !config.consumerSecret) {
      throw new InternalServerErrorException({ statusCode: 500, message: 'Equity Bank credentials are not configured', error: 'EQUITY_BANK_CONFIGURATION_ERROR' });
    }
    const authPayload = { merchantCode: config.merchantCode, consumerSecret: config.consumerSecret };
    this.debugLog('AUTH_REQUEST', {
      url: config.tokenUrl,
      method: 'POST',
      headers: { Accept: 'application/json', 'Content-Type': 'application/json', 'Api-Key': config.apiKey },
      payload: { merchantCode: config.merchantCode, consumerSecret: config.consumerSecret },
    });
    const response = await fetch(config.tokenUrl, {
      method: 'POST',
      headers: { Accept: 'application/json', 'Content-Type': 'application/json', 'Api-Key': config.apiKey },
      body: JSON.stringify(authPayload),
    });
    const body = await response.json().catch(() => ({})) as Record<string, unknown>;
    this.debugLog('AUTH_RESPONSE', { url: config.tokenUrl, status: response.status, ok: response.ok, response: body });
    const token = typeof body.accessToken === 'string' ? body.accessToken : undefined;
    if (!response.ok || !token) {
      throw new ServiceUnavailableException({ statusCode: 503, message: 'Equity Bank authentication failed', error: 'EQUITY_BANK_AUTHENTICATION_FAILED', providerStatus: response.status, details: body });
    }
    const tokenType = typeof body.tokenType === 'string' && body.tokenType ? body.tokenType : 'Bearer';
    this.debugLog('AUTH_TOKEN_READY', { tokenType, token: token, tokenFingerprint: this.fingerprint(token), tokenLength: token.length });
    return `${tokenType} ${token}`;
  }

  protected sign(value: string, config: EquityBankConfig): string {
    const signature = createSign('RSA-SHA256').update(value, 'utf8').sign(config.privateKey).toString('base64');
    this.debugLog('SIGNATURE', { input: value, signature, signatureFingerprint: this.fingerprint(signature) });
    return signature;
  }

  protected async request(url: string, method: 'GET' | 'POST', authorization: string, signature: string, payload: object | undefined) {
    const requestBody = payload ? JSON.stringify(payload) : undefined;
    const config = this.getConfig();
    this.debugLog('REQUEST', {
      url,
      method,
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        Authorization: authorization,
        Signature: signature,
      },
      payload: requestBody ?? null,
    });
    const response = await fetch(url, {
      method,
      headers: { Accept: 'application/json', 'Content-Type': 'application/json', Authorization: authorization, Signature: signature },
      body: requestBody,
    });
    const body = await response.json().catch(() => ({})) as Record<string, unknown>;
    this.debugLog('RESPONSE', { url, method, status: response.status, ok: response.ok, response: body });
    this.debugLog('RESPONSE_API_KEY_USED', { url, method, apiKey: config.apiKey, merchantCode: config.merchantCode, status: response.status, ok: response.ok, response: body });
    if (!response.ok || body.status === false) {
      throw new ServiceUnavailableException({ statusCode: 503, message: 'Equity Bank request failed', error: 'EQUITY_BANK_REQUEST_FAILED', providerStatus: response.status, details: body });
    }
    return body;
  }
}
