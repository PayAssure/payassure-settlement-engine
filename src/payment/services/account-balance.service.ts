import { getMpesaCallbackUrl, getMpesaEnv } from '../config/mpesa.env';
import { generateSecurityCredential } from '../lib/mpesa-security-credential';
import { mpesaService } from './mpesa.service';

class AccountBalanceService {
  async queryAccountBalance(): Promise<Record<string, unknown>> {
    const env = getMpesaEnv();
    const shortcode = env.shortcode || '174379';
    const partyA = env.partyA || shortcode;
    const payload = {
      Initiator: env.initiatorName || 'testapi',
      SecurityCredential: generateSecurityCredential(),
      CommandID: 'AccountBalance',
      PartyA: partyA,
      IdentifierType: '4',
      Remarks: 'Account balance query',
      QueueTimeOutURL: getMpesaCallbackUrl('/account-balance'),
      ResultURL: getMpesaCallbackUrl('/account-balance'),
    };

    const response = await mpesaService.makeRequest('account_balance', payload);
    return {
      originatorConversationId: response.OriginatorConversationID,
      conversationId: response.ConversationID,
      responseCode: response.ResponseCode,
      responseDescription: response.ResponseDescription,
      timestamp: new Date().toISOString(),
    };
  }
}

export const accountBalanceService = new AccountBalanceService();
