import { getMpesaCallbackUrl, resolveMpesaCallbackUrl } from '../../../payment/config/mpesa.env';
import { getRetailerEscrowMpesaConfig } from '../../config/retailer-escrow.env';
import { accountBalanceService } from '../../../payment/services/account-balance.service';

class RetailerEscrowBalanceService {
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
  ): Promise<Record<string, unknown>> {
    const retailer = getRetailerEscrowMpesaConfig();
    const shortcode = retailer.shortcode || '174379';
    const partyA = retailer.partyA || shortcode;
    return accountBalanceService.queryAccountBalance({
      initiatorName: retailer.initiatorName,
      initiatorPassword: retailer.initiatorPassword,
      partyA,
      identifierType: '2',
      remarks: 'Retailer escrow balance query',
      timeoutUrl: this.resolveCallbackUrl(timeoutRoute),
      resultUrl: this.resolveCallbackUrl(resultRoute),
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