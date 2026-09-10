import { getMpesaEnv } from '../config/mpesa.env';
import { generateSecurityCredential } from '../lib/mpesa-security-credential';
import { mpesaService } from './mpesa.service';
import type { MpesaEnv } from '../types/mpesa';

function resolveCallbackUrl(requestCallbackUrl?: string, envCallbackUrl?: string): string {
  const base = (requestCallbackUrl ?? envCallbackUrl ?? 'https://example.com').replace(/\/+$/, '');
  if (base.includes('/callbacks/mpesa')) return base;
  return `${base}/callbacks/mpesa`;
}

class B2CService {
  async initiateB2C(request: Record<string, any>): Promise<Record<string, unknown>> {
    const env = getMpesaEnv() as MpesaEnv;
    const initiatorName = process.env.MPESA_INITIATOR_NAME || env.MPESA_INITIATOR_NAME || 'testapi';
    const securityCredential = generateSecurityCredential();
    const partyA = process.env.MPESA_PARTYA || env.MPESA_PARTYA || env.MPESA_SHORTCODE || '174379';
    const callbackUrl = resolveCallbackUrl(request.callbackUrl, env.MPESA_CALLBACK_URL);

    const payload = {
      OriginatorConversationID: request.OriginatorConversationID || request.originatorConversationId || `${Date.now()}_b2c`,
      InitiatorName: initiatorName,
      SecurityCredential: securityCredential,
      CommandID: request.CommandID || 'BusinessPayment',
      Amount: String(request.Amount ?? request.amount ?? 0),
      PartyA: String(partyA),
      PartyB: String(request.PartyB ?? request.partyB ?? request.recipientPhone ?? ''),
      Remarks: request.Remarks || request.remarks || 'B2C payment',
      QueueTimeOutURL: request.QueueTimeOutURL || request.queueTimeoutUrl || callbackUrl,
      ResultURL: request.ResultURL || request.resultUrl || callbackUrl,
      Occassion: request.Occassion || request.occasion || undefined,
    };

    console.log('[B2C][GATEWAY][EXACT_PAYLOAD]', JSON.stringify({
      request,
      payload: { ...payload, SecurityCredential: '[generated from initiator password]' },
      environment: { partyA, callbackUrl, securityCredentialConfigured: !!securityCredential },
    }, null, 2));

    try {
      const response = await mpesaService.makeRequest('b2c', payload);
      const responseCode = response.ResponseCode ?? response.responseCode ?? 'UNKNOWN';
      const responseDescription = response.ResponseDescription ?? response.responseDescription ?? 'Unknown M-Pesa B2C response';

      return {
        responseCode,
        responseDescription,
        originatorConversationId: response.OriginatorConversationID ?? response.originatorConversationId,
        conversationId: response.ConversationID ?? response.conversationId,
        timestamp: new Date().toISOString(),
        success: String(responseCode) === '0',
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      console.error('[B2C][RESPONSE][ERROR]', { error: errorMessage, initiator: initiatorName, partyA, timestamp: new Date().toISOString() });
      throw error;
    }
  }
}

export const b2cService = new B2CService();
