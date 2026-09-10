import { getMpesaEnv } from '../config/mpesa.env';
import { generateSecurityCredential } from '../lib/mpesa-security-credential';
import { mpesaService } from './mpesa.service';
import type { B2BRequest, MpesaEnv } from '../types/mpesa';

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

function resolveAccountReference(requestAccountReference?: string, fallback = 'B2B Payment'): string {
  return requestAccountReference || fallback;
}

function resolveDescription(requestDescription?: string, fallback = 'B2B Transfer'): string {
  return requestDescription || fallback;
}

class B2BService {
  async initiateB2B(request: B2BRequest): Promise<Record<string, unknown>> {
    const env = getMpesaEnv() as MpesaEnv;
    const initiatorName = process.env.MPESA_INITIATOR_NAME || env.MPESA_INITIATOR_NAME || 'testapi';
    const partyA = process.env.MPESA_PARTYA || env.MPESA_PARTYA || env.MPESA_SHORTCODE || '174379';
    const securityCredential = generateSecurityCredential();

    const payload = {
      Initiator: initiatorName,
      SecurityCredential: securityCredential,
      CommandID: 'BusinessPayBill',
      SenderIdentifierType: '4',
      RecieverIdentifierType: '4',
      Amount: Math.floor(Number(request.amount ?? 0)),
      PartyA: partyA,
      PartyB: request.recipientShortCode || request.recieverPartyPublicID || env.MPESA_SHORTCODE || '174379',
      AccountReference: resolveAccountReference(request.accountReference, 'B2B Payment'),
      Remarks: resolveDescription(request.description, 'B2B Transfer'),
      QueueTimeOutURL: resolveCallbackUrl(request.callbackUrl, env.MPESA_CALLBACK_URL, '/callbacks/mpesa'),
      ResultURL: resolveCallbackUrl(request.callbackUrl, env.MPESA_CALLBACK_URL, '/callbacks/mpesa'),
    };

    console.log('[B2B][GATEWAY][EXACT_PAYLOAD]', JSON.stringify({
      request,
      payload: {
        ...payload,
        SecurityCredential: '[generated from initiator password]',
      },
      environment: {
        shortCode: env.MPESA_SHORTCODE,
        partyA,
        callbackUrl: env.MPESA_CALLBACK_URL,
        securityCredentialConfigured: !!securityCredential,
      },
    }, null, 2));

    try {
      const response = await mpesaService.makeRequest('b2b', payload as Record<string, unknown>);
      const responseCode = response.ResponseCode ?? response.responseCode ?? 'UNKNOWN';
      const responseDescription = response.ResponseDescription ?? response.responseDescription ?? 'Unknown M-Pesa B2B response';

      return {
        responseCode,
        responseDescription,
        originatorConversationId: response.OriginatorConversationID ?? response.originatorConversationId,
        conversationId: `${Date.now()}`,
        timestamp: new Date().toISOString(),
        success: String(responseCode) === '0',
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      console.error('[B2B][RESPONSE][ERROR]', {
        error: errorMessage,
        initiator: initiatorName,
        partyA,
        partyB: request.recipientShortCode || 'not set',
        amount: request.amount,
        securityCredentialStatus: securityCredential ? 'CONFIGURED' : 'MISSING',
        timestamp: new Date().toISOString(),
        troubleshooting: {
          hint1: 'If 403: SecurityCredential may be expired - regenerate using MPESA_INITIATOR_PASSWORD',
          hint2: 'If 403: Verify initiator is authorized for B2B transactions',
          hint3: 'If 403: Check IP whitelisting on M-Pesa account',
          hint4: 'If 403: Verify MPESA_ENVIRONMENT matches credentials (sandbox/production)',
          hint5: 'If timeout: Check callback URLs are publicly accessible',
        },
      });
      throw error;
    }
  }
}

export const b2bService = new B2BService();
