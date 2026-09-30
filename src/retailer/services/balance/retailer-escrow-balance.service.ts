import { Logger } from '@nestjs/common';
import { getMpesaCallbackUrl, resolveMpesaCallbackUrl } from '../../../payment/config/mpesa.env';
import { getRetailerEscrowMpesaConfig, getRetailerEscrowMpesaLogContext } from '../../config/retailer-escrow.env';
import { accountBalanceService } from '../../../payment/services/account-balance.service';

class RetailerEscrowBalanceService {
  private readonly logger = new Logger(RetailerEscrowBalanceService.name);

  private resolveCallbackUrl(route = '/account-balance'): string {
    const configuredUrl = (process.env.MPESA_RETAILER_CALLBACK_URL || '').trim().replace(/\/+$/, '');
    if (!configuredUrl) {
      return getMpesaCallbackUrl(route);
    }
    return resolveMpesaCallbackUrl(configuredUrl, route);
  }

  async queryBalance(
    resultRoute = '/account-balance',
    timeoutRoute = '/account-balance',
    context: { settlementId?: string; transferId?: string; retailerMerchantId?: string } = {},
  ): Promise<Record<string, unknown>> {
    const retailer = getRetailerEscrowMpesaConfig();
    const shortcode = retailer.shortcode || '174379';
    const partyA = retailer.partyA || shortcode;
    const resultUrl = this.resolveCallbackUrl(resultRoute);
    const timeoutUrl = this.resolveCallbackUrl(timeoutRoute);
    this.logger.log('[ESCROW_TRANSFER][CONFIG][ACCOUNT_BALANCE]', {
      ...context,
      retailerMpesaConfig: getRetailerEscrowMpesaLogContext(retailer),
      request: { command: 'AccountBalance', partyA, identifierType: '2', resultUrl, timeoutUrl },
    });
    return accountBalanceService.queryAccountBalance({
      initiatorName: retailer.initiatorName,
      initiatorPassword: retailer.initiatorPassword,
      partyA,
      identifierType: '2',
      remarks: 'Retailer escrow balance query',
      timeoutUrl,
      resultUrl,
      requestLogLabel: '[ESCROW_BALANCE_API]',
      credentials: {
        environment: retailer.environment,
        consumerKey: retailer.consumerKey,
        consumerSecret: retailer.consumerSecret,
      },
    });
  }
}

export const retailerEscrowBalanceService = new RetailerEscrowBalanceService();