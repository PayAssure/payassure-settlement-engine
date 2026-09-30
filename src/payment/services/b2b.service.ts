import { getMpesaCallbackUrl, getMpesaEnv } from '../config/mpesa.env';
import { generateSecurityCredential } from '../lib/mpesa-security-credential';
import { mpesaService } from './mpesa.service';
import type { B2BRequest } from '../types/mpesa';
import { normalizeMpesaResponse } from '../utils/normalize-mpesa-response';

function resolveAccountReference(requestAccountReference?: string, fallback = 'B2B Payment'): string {
  return requestAccountReference || fallback;
}

function resolveDescription(requestDescription?: string, fallback = 'B2B Transfer'): string {
  return requestDescription || fallback;
}

class B2BService {
  async initiateB2B(request: B2BRequest): Promise<Record<string, unknown>> {
    const env = getMpesaEnv();
    const initiatorName = request.initiatorName || env.initiatorName || 'testapi';
    const partyA = request.partyA || env.partyA || env.shortcode || '174379';
    const securityCredential = generateSecurityCredential(undefined, request.initiatorPassword ?? env.initiatorPassword);
    const callbackUrl = request.callbackUrl || getMpesaCallbackUrl();

    const payload = {
      Initiator: initiatorName,
      SecurityCredential: securityCredential,
      CommandID: 'BusinessPayBill',
      SenderIdentifierType: '4',
      RecieverIdentifierType: '4',
      Amount: Math.floor(Number(request.amount ?? 0)),
      PartyA: partyA,
      PartyB: request.recipientShortCode || request.recieverPartyPublicID || env.shortcode || '174379',
      AccountReference: resolveAccountReference(request.accountReference, 'B2B Payment'),
      Remarks: request.remarks || resolveDescription(request.description, 'B2B Transfer'),
      QueueTimeOutURL: request.queueTimeOutUrl || callbackUrl,
      ResultURL: request.resultUrl || callbackUrl,
    };

    console.log('[B2B][GATEWAY][EXACT_PAYLOAD]', JSON.stringify({
      amount: request.amount,
      partyA,
      partyB: payload.PartyB,
      accountReference: payload.AccountReference,
      remarks: payload.Remarks,
      payload: {
        ...payload,
        SecurityCredential: '[generated from initiator password]',
      },
      environment: {
        environment: request.credentials?.environment ?? env.environment,
        partyA,
        partyB: payload.PartyB,
        resultUrl: payload.ResultURL,
        timeoutUrl: payload.QueueTimeOutURL,
        securityCredentialConfigured: !!securityCredential,
      },
    }, null, 2));

    try {
      const response = await mpesaService.makeRequest('b2b', payload as Record<string, unknown>, request.credentials);
      return normalizeMpesaResponse(response, 'B2B', `${Date.now()}`);
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
