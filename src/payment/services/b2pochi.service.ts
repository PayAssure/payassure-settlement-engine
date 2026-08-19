import { getMpesaEnv } from '../config/mpesa.env';
import { mpesaService } from './mpesa.service';
import type { MpesaEnv } from '../types/mpesa';

function resolveCallbackUrl(requestCallbackUrl?: string, envCallbackUrl?: string, endpoint = '/callbacks/mpesa'): string {
  const normalizedEndpoint = endpoint.startsWith('/') ? endpoint : `/${endpoint}`;
  const base = (requestCallbackUrl ?? envCallbackUrl ?? 'https://example.com').replace(/\/+$/, '');

  if (base.includes('/callbacks/mpesa')) {
    return base;
  }

  if (base.includes('/settlement/payouts/callback')) {
    return `${base}${normalizedEndpoint}`;
  }

  return `${base}${normalizedEndpoint}`;
}

function resolveDescription(requestDescription?: string, fallback = 'B2Pochi transfer'): string {
  return requestDescription || fallback;
}

class B2PochiService {
  async initiateB2Pochi(request: Record<string, any>): Promise<Record<string, unknown>> {
    const env = getMpesaEnv() as MpesaEnv;
    const initiatorName = process.env.MPESA_INITIATOR_NAME || env.MPESA_INITIATOR_NAME || 'testapi';
    const securityCredential = process.env.MPESA_SECURITY_CREDENTIAL || env.MPESA_SECURITY_CREDENTIAL || '';
    const partyA = process.env.MPESA_PARTYA || env.MPESA_PARTYA || env.MPESA_SHORTCODE || '174379';

    const payload = {
      OriginatorConversationID: request.OriginatorConversationID || request.originatorConversationId || `${Date.now()}_pochi_${Math.random().toString(36).slice(2, 10)}`,
      InitiatorName: initiatorName,
      SecurityCredential: securityCredential,
      CommandID: request.CommandID || 'BusinessPayToPochi',
      Amount: String(request.Amount ?? request.amount ?? 0),
      PartyA: partyA,
      PartyB: request.PartyB || request.partyB || request.recipientPhone || '',
      Remarks: resolveDescription(request.Remarks || request.remarks, 'B2Pochi disbursement'),
      QueueTimeOutURL: request.QueueTimeOutURL || request.queueTimeoutUrl || resolveCallbackUrl(request.callbackUrl, env.MPESA_CALLBACK_URL, '/callbacks/mpesa'),
      ResultURL: request.ResultURL || request.resultUrl || resolveCallbackUrl(request.callbackUrl, env.MPESA_CALLBACK_URL, '/callbacks/mpesa'),
      Occassion: request.Occassion || request.occasion || undefined,
    };

    console.log('[B2POCHI][GATEWAY][EXACT_PAYLOAD]', JSON.stringify({
      request,
      payload: {
        ...payload,
        SecurityCredential: securityCredential ? '[set from MPESA_SECURITY_CREDENTIAL]' : '[missing MPESA_SECURITY_CREDENTIAL]',
      },
      environment: {
        shortCode: env.MPESA_SHORTCODE,
        partyA,
        callbackUrl: env.MPESA_CALLBACK_URL,
        securityCredentialConfigured: !!securityCredential,
      },
    }, null, 2));

    try {
      const response = await mpesaService.makeRequest('b2pochi', payload as Record<string, unknown>);
      const responseCode = response.ResponseCode ?? response.responseCode ?? 'UNKNOWN';
      const responseDescription = response.ResponseDescription ?? response.responseDescription ?? 'Unknown M-Pesa B2Pochi response';

      console.log('[B2POCHI][RESPONSE][SUCCESS]', {
        responseCode,
        responseDescription,
        originatorConversationId: response.OriginatorConversationID ?? response.originatorConversationId,
        conversationId: response.ConversationID ?? response.conversationId,
        timestamp: new Date().toISOString(),
      });

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
      console.error('[B2POCHI][RESPONSE][ERROR]', {
        error: errorMessage,
        initiator: initiatorName,
        partyA,
        partyB: request.PartyB || request.partyB || 'not set',
        amount: request.Amount ?? request.amount,
        securityCredentialStatus: securityCredential ? 'CONFIGURED' : 'MISSING',
        timestamp: new Date().toISOString(),
        troubleshooting: {
          hint1: 'If 403: SecurityCredential may be expired - regenerate using MPESA_INITIATOR_PASSWORD',
          hint2: 'If 403: Verify initiator is authorized for B2Pochi transactions',
          hint3: 'If 403: Check IP whitelisting on M-Pesa account',
          hint4: 'If 403: Verify MPESA_ENVIRONMENT matches credentials (sandbox/production)',
          hint5: 'If timeout: Check callback URLs are publicly accessible',
        },
      });
      throw error;
    }
  }
}

export const b2pochiService = new B2PochiService();
