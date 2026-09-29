import { getMpesaCallbackUrls } from '../../config/mpesa.env';
import { MpesaStkOperationsBase } from './stk-operations.base';

export abstract class MpesaPayoutOperationsBase extends MpesaStkOperationsBase {
  async dispatchB2bPayout(payload: Record<string, any>): Promise<Record<string, unknown>> {
    const env = this.currentEnvironment();
    const timestamp = this.generateTimestamp();
    const shortcode = env.shortcode || '174379';
    const passkey = env.passkey || '';
    const request = {
      ...payload,
      BusinessShortCode: shortcode,
      Password: this.buildPassword(shortcode, passkey, timestamp),
      Timestamp: timestamp,
      ...getMpesaCallbackUrls(),
    };
    return this.makeRequest('b2b', request);
  }

  async dispatchB2PochiPayment(payload: Record<string, any>): Promise<Record<string, unknown>> {
    const request = {
      ...payload,
      CommandID: payload.CommandID || 'BusinessPayToPochi',
      Amount: String(payload.Amount ?? '0'),
      PartyB: Number(payload.PartyB ?? payload.partyB ?? payload.recipientPhone ?? 0),
      ...getMpesaCallbackUrls(),
    };
    const response = await this.makeRequest('b2pochi', request);
    return {
      originatorConversationId: response.OriginatorConversationID,
      conversationId: response.ConversationID,
      responseCode: response.ResponseCode,
      responseDescription: response.ResponseDescription,
      timestamp: new Date().toISOString(),
    };
  }

  async dispatchB2CPayment(payload: Record<string, any>): Promise<Record<string, unknown>> {
    const request = {
      ...payload,
      CommandID: payload.CommandID || 'BusinessPayment',
      Amount: String(payload.Amount ?? '0'),
      PartyA: String(payload.PartyA ?? payload.partyA ?? ''),
      PartyB: String(payload.PartyB ?? payload.partyB ?? payload.recipientPhone ?? ''),
      ...getMpesaCallbackUrls(),
    };
    const response = await this.makeRequest('b2c', request);
    return {
      originatorConversationId: response.OriginatorConversationID,
      conversationId: response.ConversationID,
      responseCode: response.ResponseCode,
      responseDescription: response.ResponseDescription,
      timestamp: new Date().toISOString(),
    };
  }
}
