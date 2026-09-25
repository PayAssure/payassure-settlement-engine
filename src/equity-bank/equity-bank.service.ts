import { Injectable, InternalServerErrorException, Logger, ServiceUnavailableException } from '@nestjs/common';
import { createHash, createPrivateKey, createSign } from 'crypto';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import {
  EquityBankAccountBalanceDto,
  EquityBankInternalTransferDto,
  EquityBankPesalinkBankDto,
  EquityBankPesalinkMobileDto,
} from './dto/equity-bank.dto';

interface EquityBankConfig {
  tokenUrl: string;
  accountBalanceUrl: string;
  internalTransferUrl: string;
  pesalinkBankUrl: string;
  pesalinkMobileUrl: string;
  apiKey?: string;
  merchantCode?: string;
  consumerSecret?: string;
  privateKey: string;
}

@Injectable()
export class EquityBankService {
  private readonly logger = new Logger(EquityBankService.name);

  private getConfig(): EquityBankConfig {
    const live = process.env.EQUITY_BANK_ENVIRONMENT === 'production' || process.env.EQUITY_BANK_ENVIRONMENT === 'live';
    const baseUrl = process.env.EQUITY_BANK_BASE_URL || (live ? 'https://api.finserve.africa' : 'https://uat.finserve.africa');
    return {
      tokenUrl: process.env.EQUITY_BANK_TOKEN_URL || `${baseUrl}/authentication/api/v3/authenticate/merchant`,
      accountBalanceUrl: process.env.EQUITY_BANK_ACCOUNT_BALANCE_URL || `${baseUrl}/v3-apis/account-api/v3.0/accounts/balances`,
      internalTransferUrl: process.env.EQUITY_BANK_INTERNAL_TRANSFER_URL || `${baseUrl}/v3-apis/transaction-api/v3.0/remittance/internalBankTransfer`,
      pesalinkBankUrl: process.env.EQUITY_BANK_PESALINK_BANK_URL || `${baseUrl}/v3-apis/transaction-api/v3.0/remittance/pesalinkacc`,
      pesalinkMobileUrl: process.env.EQUITY_BANK_PESALINK_MOBILE_URL || `${baseUrl}/v3-apis/transaction-api/v3.0/remittance/pesalinkMobile`,
      apiKey: process.env.EQUITY_BANK_API_KEY,
      merchantCode: process.env.EQUITY_BANK_MERCHANT_CODE,
      consumerSecret: process.env.EQUITY_BANK_CONSUMER_SECRET,
      privateKey: this.loadPrivateKey(),
    };
  }

  private loadPrivateKey(): string {
    const privateKeyPath = resolve(process.env.EQUITY_BANK_PRIVATE_KEY_PATH || 'privatekey.pem');
    try {
      const pem = readFileSync(privateKeyPath, 'utf8').trim();
      createPrivateKey({ key: pem, format: 'pem' });
      return pem;
    } catch {
      throw new InternalServerErrorException({
        statusCode: 500,
        message: `Equity Bank private key file could not be read or parsed: ${privateKeyPath}`,
        error: 'EQUITY_BANK_CONFIGURATION_ERROR',
      });
    }
  }

  async getAccountBalance(request: EquityBankAccountBalanceDto) {
    const config = this.getConfig();
    const authorization = await this.getAuthorization(config);
    const countryCode = request.countryCode.trim();
    const accountId = request.accountId.trim();
    const date = request.date?.trim() || new Date().toISOString().slice(0, 10);
    const signature = this.sign(`${accountId}${countryCode}${date}`, config);
    return this.request(config.accountBalanceUrl + `/${encodeURIComponent(countryCode)}/${encodeURIComponent(accountId)}`, 'GET', authorization, signature, undefined);
  }

  async internalBankTransfer(request: EquityBankInternalTransferDto) {
    const config = this.getConfig();
    const authorization = await this.getAuthorization(config);
    const signature = this.sign(`${request.source.accountNumber}${request.transfer.amount}${request.transfer.currencyCode}${request.transfer.reference}`, config);
    return this.request(config.internalTransferUrl, 'POST', authorization, signature, request);
  }

  async pesalinkBankTransfer(request: EquityBankPesalinkBankDto) {
    return this.pesalinkTransfer(request, this.getConfig().pesalinkBankUrl);
  }

  async pesalinkMobileTransfer(request: EquityBankPesalinkMobileDto) {
    return this.pesalinkTransfer(request, this.getConfig().pesalinkMobileUrl);
  }

  private async pesalinkTransfer(request: EquityBankInternalTransferDto, url: string) {
    const config = this.getConfig();
    const authorization = await this.getAuthorization(config);
    const signature = this.sign(`${request.transfer.amount}${request.transfer.currencyCode}${request.transfer.reference}${request.destination.name}${request.source.accountNumber}`, config);
    return this.request(url, 'POST', authorization, signature, request);
  }

  private async getAuthorization(config: EquityBankConfig): Promise<string> {
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

  private sign(value: string, config: EquityBankConfig): string {
    const signature = createSign('RSA-SHA256').update(value, 'utf8').sign(config.privateKey).toString('base64');
    this.debugLog('SIGNATURE', { input: value, signature, signatureFingerprint: this.fingerprint(signature) });
    return signature;
  }

  private async request(url: string, method: 'GET' | 'POST', authorization: string, signature: string, payload: object | undefined) {
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

  private debugLog(event: string, details: Record<string, unknown>): void {
    const debugMode = (process.env.EQUITY_BANK_DEBUG_LOGGING || '').toLowerCase();
    if (!debugMode) return;

    const payload = debugMode === 'redacted' || debugMode === 'masked' ? this.sanitizeForLogging(details) : details;
    this.logger.log(`[EQUITY_BANK][${event}] ${JSON.stringify(payload)}`);
  }

  private sanitizeForLogging(value: unknown): unknown {
    if (typeof value === 'string') {
      const trimmed = value.trim();
      if ((trimmed.startsWith('{') && trimmed.endsWith('}')) || (trimmed.startsWith('[') && trimmed.endsWith(']'))) {
        try {
          return this.sanitizeForLogging(JSON.parse(trimmed));
        } catch {
          return value;
        }
      }
      return value;
    }
    if (Array.isArray(value)) {
      return value.map((item) => this.sanitizeForLogging(item));
    }
    if (value && typeof value === 'object') {
      return Object.fromEntries(
        Object.entries(value).map(([key, child]) => {
          const normalizedKey = key.toLowerCase();
          const shouldRedact = /(?:secret|token|signature|authorization|password|passphrase|private[_-]?key|merchant[_-]?code|consumer[_-]?secret|api[_-]?key)/.test(normalizedKey);
          return [key, shouldRedact ? this.maskSecret(this.stringifyForLogging(child)) : this.sanitizeForLogging(child)];
        }),
      );
    }
    return value;
  }

  private stringifyForLogging(value: unknown): string {
    if (value === undefined || value === null) return '';
    if (typeof value === 'string') return value;
    return JSON.stringify(value);
  }

  private maskSecret(value: string | undefined): string {
    if (!value) return '[not-set]';
    return `[redacted fingerprint=${this.fingerprint(value)}]`;
  }

  private sanitizeAuthResponse(body: Record<string, unknown>): Record<string, unknown> {
    return {
      ...body,
      accessToken: typeof body.accessToken === 'string' ? this.maskSecret(body.accessToken) : body.accessToken,
      refreshToken: typeof body.refreshToken === 'string' ? this.maskSecret(body.refreshToken) : body.refreshToken,
    };
  }

  private fingerprint(value: string): string {
    return createHash('sha256').update(value).digest('hex').slice(0, 16);
  }
}