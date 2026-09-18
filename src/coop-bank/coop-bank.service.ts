import { Injectable, InternalServerErrorException, Logger, ServiceUnavailableException } from '@nestjs/common';
import { createHash } from 'crypto';
import { CoopBankAccountEnquiryDto } from './dto/coop-bank-account-enquiry.dto';

interface CoopBankConfig {
  baseUrl: string;
  tokenUrl: string;
  accountEnquiryUrl: string;
  consumerKey?: string;
  consumerSecret?: string;
}

interface CoopBankAccessToken {
  authorizationHeader: string;
}

@Injectable()
export class CoopBankService {
  private readonly logger = new Logger(CoopBankService.name);

  private getConfig(): CoopBankConfig {
    const baseUrl = process.env.COOP_BANK_BASE_URL || 'https://developer.co-opbank.co.ke:8243';

    return {
      baseUrl,
      tokenUrl: process.env.COOP_BANK_TOKEN_URL || `${baseUrl}/token`,
      accountEnquiryUrl: process.env.COOP_BANK_ACCOUNT_ENQUIRY_URL || `${baseUrl}/Enquiry/AccountTransactions/1.0.0/Account`,
      consumerKey: process.env.COOP_BANK_CONSUMER_KEY,
      consumerSecret: process.env.COOP_BANK_CONSUMER_SECRET,
    };
  }

  async getAccessToken(): Promise<CoopBankAccessToken> {
    const config = this.getConfig();

    if (!config.consumerKey || !config.consumerSecret) {
      throw new InternalServerErrorException({
        statusCode: 500,
        message: 'COOP Bank consumer credentials are not configured',
        error: 'COOP_BANK_CONFIGURATION_ERROR',
      });
    }

    const basicCredentials = Buffer.from(`${config.consumerKey}:${config.consumerSecret}`).toString('base64');
    const response = await fetch(config.tokenUrl, {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        Authorization: `Basic ${basicCredentials}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: 'grant_type=client_credentials',
    });

    const responseBody = await response.json().catch(() => ({}));
    const tokenResponse = typeof responseBody === 'object' && responseBody !== null ? responseBody as Record<string, unknown> : {};
    const accessToken = typeof tokenResponse.access_token === 'string' ? tokenResponse.access_token : null;
    const tokenType = typeof tokenResponse.token_type === 'string' && tokenResponse.token_type ? tokenResponse.token_type : 'Bearer';

    if (!response.ok || !accessToken) {
      throw new ServiceUnavailableException({
        statusCode: 503,
        message: 'COOP Bank authentication failed',
        error: 'COOP_BANK_AUTHENTICATION_FAILED',
        providerStatus: response.status,
        details: responseBody,
      });
    }

    return { authorizationHeader: `${tokenType} ${accessToken}` };
  }

  async enquireAccountTransactions(request: CoopBankAccountEnquiryDto) {
    const config = this.getConfig();
    const { authorizationHeader } = await this.getAccessToken();
    this.logAuthorizationHeader('COOP Bank token obtained and used for account enquiry', authorizationHeader);

    const payload = {
      MessageReference: request.messageReference,
      AccountNumber: request.accountNumber,
      NoOfTransactions: String(request.noOfTransactions),
    };

    const response = await fetch(config.accountEnquiryUrl, {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        Authorization: authorizationHeader,
      },
      body: JSON.stringify(payload),
    });

    const responseBody = await response.json().catch(() => ({}));
    const providerMessageCode = typeof responseBody === 'object' && responseBody !== null
      ? (responseBody as Record<string, unknown>).MessageCode
      : undefined;

    if (!response.ok || String(providerMessageCode ?? '') === '1' || String(providerMessageCode ?? '') === '-1' || String(providerMessageCode ?? '') === '-2') {
      throw new ServiceUnavailableException({
        statusCode: 503,
        message: 'COOP Bank account enquiry request failed',
        error: 'COOP_BANK_ACCOUNT_ENQUIRY_FAILED',
        providerStatus: response.status,
        details: responseBody,
      });
    }

    return {
      success: true,
      provider: 'COOP Bank',
      request: payload,
      response: responseBody,
    };
  }

  private logAuthorizationHeader(message: string, authorizationHeader: string) {
    const [scheme, token] = authorizationHeader.split(' ');
    const tokenFingerprint = createHash('sha256').update(token).digest('hex').slice(0, 12);
    const maskedToken = token.length > 12 ? `${token.slice(0, 6)}...${token.slice(-6)}` : '[short-token]';

    this.logger.log(`${message}: scheme=${scheme}, token=${maskedToken}, fingerprint=${tokenFingerprint}`);
  }
}
