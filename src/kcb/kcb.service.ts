import { Injectable, InternalServerErrorException, Logger, ServiceUnavailableException } from '@nestjs/common';
import { KcbFundsTransferDto } from './dto/kcb-funds-transfer.dto';
import { logAuthorizationHeader } from './helpers/log-authorization-header';

interface KcbConfig {
  tokenUrl: string;
  transferUrl: string;
  consumerKey?: string;
  consumerSecret?: string;
  companyCode?: string;
  debitAccountNumber?: string;
}

interface KcbAccessToken {
  authorizationHeader: string;
}

@Injectable()
export class KcbService {
  private readonly logger = new Logger(KcbService.name);

  private getConfig(): KcbConfig {
    return {
      tokenUrl: process.env.KCB_TOKEN_URL || `${process.env.KCB_BASE_URL || 'https://uat.buni.kcbgroup.com'}/token?grant_type=client_credentials`,
      transferUrl: process.env.KCB_FUNDS_TRANSFER_URL || `${process.env.KCB_BASE_URL || 'https://uat.buni.kcbgroup.com'}/fundstransfer/1.0.0/api/v1/transfer`,
      consumerKey: process.env.KCB_CONSUMER_KEY,
      consumerSecret: process.env.KCB_CONSUMER_SECRET,
      companyCode: process.env.KCB_COMPANY_CODE,
      debitAccountNumber: process.env.KCB_DEBIT_ACCOUNT_NUMBER,
    };
  }

  async initiateFundsTransfer(request: KcbFundsTransferDto) {
    const config = this.getConfig();
    const payload = {
      beneficiaryDetails: request.beneficiaryDetails,
      companyCode: request.companyCode || config.companyCode,
      creditAccountNumber: request.creditAccountNumber,
      currency: request.currency,
      debitAccountNumber: request.debitAccountNumber || config.debitAccountNumber,
      debitAmount: request.debitAmount,
      paymentDetails: request.paymentDetails,
      transactionReference: request.transactionReference,
      transactionType: request.transactionType,
      beneficiaryBankCode: request.beneficiaryBankCode,
    };

    const missingConfiguration = ['companyCode', 'debitAccountNumber'].filter(
      (field) => !payload[field as keyof typeof payload],
    );
    if (missingConfiguration.length > 0) {
      throw new InternalServerErrorException({
        statusCode: 500,
        message: `KCB configuration is missing: ${missingConfiguration.join(', ')}`,
        error: 'KCB_CONFIGURATION_ERROR',
      });
    }

    const { authorizationHeader } = await this.getAccessToken(config);
    logAuthorizationHeader(this.logger, 'KCB token obtained and used for funds transfer', authorizationHeader);

    const response = await fetch(config.transferUrl, {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        Authorization: authorizationHeader,
      },
      body: JSON.stringify(payload),
    });
    const responseBody = await response.json().catch(() => ({}));

    const providerStatusCode = typeof responseBody === 'object' && responseBody !== null
      ? (responseBody as Record<string, unknown>).statusCode
      : undefined;

    if (!response.ok || providerStatusCode === '1' || providerStatusCode === 1) {
      throw new ServiceUnavailableException({
        statusCode: 503,
        message: 'KCB funds transfer request failed',
        error: 'KCB_TRANSFER_FAILED',
        providerStatus: response.status,
        details: responseBody,
      });
    }

    return {
      success: true,
      provider: 'KCB',
      transactionReference: request.transactionReference,
      response: responseBody,
    };
  }

  private async getAccessToken(config: KcbConfig): Promise<KcbAccessToken> {
    if (!config.consumerKey || !config.consumerSecret) {
      throw new InternalServerErrorException({
        statusCode: 500,
        message: 'KCB consumer credentials are not configured',
        error: 'KCB_CONFIGURATION_ERROR',
      });
    }

    const basicCredentials = Buffer.from(`${config.consumerKey}:${config.consumerSecret}`).toString('base64');
    const response = await fetch(config.tokenUrl, {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        Authorization: `Basic ${basicCredentials}`,
      },
    });
    const responseBody = await response.json().catch(() => ({}));
    const tokenResponse = typeof responseBody === 'object' && responseBody !== null
      ? responseBody as Record<string, unknown>
      : {};
    const accessToken = tokenResponse.access_token;
    const tokenType = typeof tokenResponse.token_type === 'string' && tokenResponse.token_type
      ? tokenResponse.token_type
      : 'Bearer';

    if (!response.ok || typeof accessToken !== 'string' || !accessToken) {
      throw new ServiceUnavailableException({
        statusCode: 503,
        message: 'KCB authentication failed',
        error: 'KCB_AUTHENTICATION_FAILED',
        providerStatus: response.status,
        details: responseBody,
      });
    }

    return { authorizationHeader: `${tokenType} ${accessToken}` };
  }
}