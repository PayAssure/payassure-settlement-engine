import { getRetailerEscrowMpesaConfig } from '../config/mpesa.env';
import { generateSecurityCredential } from '../lib/mpesa-security-credential';
import { mpesaService } from './mpesa.service';

function resolveCallbackUrl(callbackUrl: string, callbackPath: string): string {
  const baseUrl = callbackUrl.trim().replace(/\/+$/, '');
  const callbackBase = /\/payments\/callbacks\/mpesa$/i.test(baseUrl) || /\/callbacks\/mpesa$/i.test(baseUrl)
    ? baseUrl
    : /\/payments$/i.test(baseUrl)
      ? `${baseUrl}/callbacks/mpesa`
      : `${baseUrl}/payments/callbacks/mpesa`;
  return `${callbackBase}/${callbackPath}`;
}

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

    const payload = {
      Initiator: env.initiatorName,
      SecurityCredential: generateSecurityCredential(undefined, env.initiatorPassword),
      CommandID: 'BusinessPayBill',
      SenderIdentifierType: '4',
      RecieverIdentifierType: '4',
      Amount: Math.floor(request.amount),
      PartyA: env.partyA,
      PartyB: destinationShortcode,
      AccountReference: request.merchantTransactionReference,
      Remarks: `PayAssure escrow collection ${request.merchantTransactionReference}`,
      QueueTimeOutURL: resolveCallbackUrl(env.callbackUrl, request.timeoutCallbackPath),
      ResultURL: resolveCallbackUrl(env.callbackUrl, request.callbackPath),
    };

    const response = await mpesaService.makeRequest('b2b', payload, env);
    const responseCode = response.ResponseCode ?? response.responseCode ?? 'UNKNOWN';
    return {
      responseCode,
      responseDescription: response.ResponseDescription ?? response.responseDescription,
      originatorConversationId: response.OriginatorConversationID ?? response.originatorConversationId,
      conversationId: response.ConversationID ?? response.conversationId,
      success: String(responseCode) === '0',
      timestamp: new Date().toISOString(),
    };
  }
}

export const retailerEscrowB2bService = new RetailerEscrowB2bService();
