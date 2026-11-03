import { getMpesaCallbackUrl, getMpesaEnv } from '../config/mpesa.env';
import { generateSecurityCredential } from '../lib/mpesa-security-credential';
import { mpesaService } from './mpesa.service';
import type DispatchB2TillPayoutDto from '../dto/dispatch-b2till-payout.dto';
import { normalizeMpesaResponse } from '../utils/normalize-mpesa-response';

class B2TillService {
  async initiateB2Till(request: DispatchB2TillPayoutDto): Promise<Record<string, unknown>> {
    const env = getMpesaEnv();
    const initiatorName = env.initiatorName || 'testapi';
    const partyA = env.partyA || env.shortcode || '174379';
    const securityCredential = generateSecurityCredential(undefined, env.initiatorPassword);
    const callbackUrl = getMpesaCallbackUrl();

    const payload = {
      Initiator: initiatorName,
      SecurityCredential: securityCredential,
      CommandID: 'BusinessBuyGoods',
      SenderIdentifierType: '4',
      RecieverIdentifierType: '4',
      Amount: request.Amount,
      PartyA: partyA,
      PartyB: request.PartyB,
      AccountReference: request.AccountReference,
      Requester: request.Requester,
      Remarks: request.Remarks,
      QueueTimeOutURL: env.b2TillQueueTimeoutUrl || callbackUrl,
      ResultURL: env.b2TillResultUrl || callbackUrl,
    };

    console.log('[B2TILL][GATEWAY][EXACT_PAYLOAD]', JSON.stringify({
      payload: {
        ...payload,
        SecurityCredential: '[generated from initiator password]',
      },
      environment: {
        environment: env.environment,
        partyA,
        partyB: payload.PartyB,
        resultUrl: payload.ResultURL,
        timeoutUrl: payload.QueueTimeOutURL,
        securityCredentialConfigured: !!securityCredential,
      },
    }, null, 2));

    try {
      const response = await mpesaService.makeRequest('b2b', payload);
      return normalizeMpesaResponse(response, 'B2Till', `${Date.now()}`);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      console.error('[B2TILL][RESPONSE][ERROR]', {
        error: errorMessage,
        initiator: initiatorName,
        partyA,
        partyB: request.PartyB,
        amount: request.Amount,
        securityCredentialStatus: securityCredential ? 'CONFIGURED' : 'MISSING',
        timestamp: new Date().toISOString(),
      });
      throw error;
    }
  }
}

export const b2TillService = new B2TillService();
