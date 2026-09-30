import { Logger } from '@nestjs/common';
import { getRetailerEscrowMpesaConfig, getRetailerEscrowMpesaLogContext } from '../../config/retailer-escrow.env';
import { resolveMpesaCallbackUrl } from '../../../payment/config/mpesa.env';
import { b2bService } from '../../../payment/services/b2b.service';

class RetailerEscrowB2bService {
  private readonly logger = new Logger(RetailerEscrowB2bService.name);

  async transferToPayAssure(request: {
    amount: number;
    merchantTransactionReference: string;
    callbackPath: string;
    timeoutCallbackPath: string;
    settlementId?: string;
    transferId?: string;
  }): Promise<Record<string, unknown>> {
    const env = getRetailerEscrowMpesaConfig();
    const destinationShortcode = process.env.MPESA_RETAILER_PAYASSURE_SHORTCODE?.trim();
    if (!destinationShortcode) {
      throw new Error('Missing required retailer M-Pesa configuration: MPESA_RETAILER_PAYASSURE_SHORTCODE');
    }
    const resultUrl = resolveMpesaCallbackUrl(env.callbackUrl, request.callbackPath, '/payments/callbacks/mpesa');
    const timeoutUrl = resolveMpesaCallbackUrl(env.callbackUrl, request.timeoutCallbackPath, '/payments/callbacks/mpesa');
    this.logger.log('[ESCROW_TRANSFER][CONFIG][B2B_TRANSFER]', {
      settlementId: request.settlementId,
      transferId: request.transferId,
      merchantTransactionReference: request.merchantTransactionReference,
      amount: request.amount,
      retailerMpesaConfig: {
        ...getRetailerEscrowMpesaLogContext(env),
        payassureShortcode: { variable: 'MPESA_RETAILER_PAYASSURE_SHORTCODE', value: destinationShortcode },
      },
      request: {
        partyA: env.partyA,
        partyB: destinationShortcode,
        initiatorName: env.initiatorName,
        resultUrl,
        timeoutUrl,
      },
    });

    return b2bService.initiateB2B({
      amount: request.amount,
      recipientShortCode: destinationShortcode,
      partyA: env.partyA,
      initiatorName: env.initiatorName,
      initiatorPassword: env.initiatorPassword,
      accountReference: request.merchantTransactionReference,
      remarks: `PayAssure escrow collection ${request.merchantTransactionReference}`,
      queueTimeOutUrl: timeoutUrl,
      resultUrl,
      credentials: env,
    });
  }
}

export const retailerEscrowB2bService = new RetailerEscrowB2bService();
