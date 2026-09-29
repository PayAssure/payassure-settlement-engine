import { InternalServerErrorException } from '@nestjs/common';
import { createPrivateKey } from 'crypto';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { EquityBankDebugBase } from './debug.base';
import type { EquityBankConfig } from './types';

export abstract class EquityBankConfigBase extends EquityBankDebugBase {
  protected getConfig(): EquityBankConfig {
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

  protected loadPrivateKey(): string {
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
}
