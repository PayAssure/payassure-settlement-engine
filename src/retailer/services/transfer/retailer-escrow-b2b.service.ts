import { getRetailerEscrowMpesaConfig } from '../../config/retailer-escrow.env';
import { resolveMpesaCallbackUrl } from '../../../payment/config/mpesa.env';
import { b2bService } from '../../../payment/services/b2b.service';

class RetailerEscrowB2bService {
  async transferToPayAssure(request: {
    amount: number;
    merchantTransactionReference: string;
    callbackPath: string;
    timeoutCallbackPath: string;
  }): Promise<Record<string, unknown>> {
    const env = getRetailerEscrowMpesaConfig();
    const destinationShortcode = process.env.MPESA_RETAILER_PAYASSURE_SHORTCODE?.trim();
    if (!destinationShortcode) {
      throw new Error('Missing required retailer M-Pesa configuration: MPESA_RETAILER_PAYASSURE_SHORTCODE');
    }

    return b2bService.initiateB2B({
      amount: request.amount,
      recipientShortCode: destinationShortcode,
      partyA: env.partyA,
      initiatorName: env.initiatorName,
      initiatorPassword: env.initiatorPassword,
      accountReference: request.merchantTransactionReference,
      remarks: `PayAssure escrow collection ${request.merchantTransactionReference}`,
      queueTimeOutUrl: resolveMpesaCallbackUrl(env.callbackUrl, request.timeoutCallbackPath, '/payments/callbacks/mpesa'),
      resultUrl: resolveMpesaCallbackUrl(env.callbackUrl, request.callbackPath, '/payments/callbacks/mpesa'),
      credentials: env,
    });
  }
}

export const retailerEscrowB2bService = new RetailerEscrowB2bService();
