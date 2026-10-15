import { Logger } from '@nestjs/common';
import { getMpesaCallbackUrl, resolveMpesaCallbackUrl } from '../../../payment/config/mpesa.env';
import { accountBalanceService } from '../../../payment/services/account-balance.service';
import { getRetailerEscrowMpesaConfig, getRetailerEscrowMpesaLogContext } from '../../config/retailer-escrow.env';

class RetailerEscrowBalanceService {
  private readonly logger = new Logger(RetailerEscrowBalanceService.name);

  private resolveCallbackUrl(route: string): string {
    const configuredUrl = getRetailerEscrowMpesaConfig().callbackUrl.trim().replace(/\/+$/, '');
    return configuredUrl
      ? resolveMpesaCallbackUrl(configuredUrl, route)
      : getMpesaCallbackUrl(route);
  }

  async queryBalance(
    resultRoute = 'retailer-escrow-balance',
    timeoutRoute = 'retailer-escrow-balance-timeout',
    context: { settlementId?: string; transferId?: string; retailerMerchantId?: string; reconciliationId?: string } = {},
  ): Promise<Record<string, unknown>> {
    const retailer = getRetailerEscrowMpesaConfig();
    const partyA = retailer.partyA || retailer.shortcode;
    const resultUrl = this.resolveCallbackUrl(resultRoute);
    const timeoutUrl = this.resolveCallbackUrl(timeoutRoute);
    this.logger.log('[RETAILER_ESCROW][ACCOUNT_BALANCE][REQUEST]', {
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
      resultUrl,
      timeoutUrl,
      requestLogLabel: '[RETAILER_ESCROW_BALANCE_API]',
      credentials: {
        environment: retailer.environment,
        consumerKey: retailer.consumerKey,
        consumerSecret: retailer.consumerSecret,
      },
    });
  }
}

export const retailerEscrowBalanceService = new RetailerEscrowBalanceService();