import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import { mpesaService } from '../../payment/services/mpesa.service';
import { retailerEscrowB2bService } from './transfer/retailer-escrow-b2b.service';

test('retailer escrow B2B delegates payload construction to the shared payment service', async () => {
  const envNames = [
    'MPESA_RETAILER_ENVIRONMENT',
    'MPESA_RETAILER_CONSUMER_KEY',
    'MPESA_RETAILER_CONSUMER_SECRET',
    'MPESA_RETAILER_SHORTCODE',
    'MPESA_RETAILER_PARTY_A',
    'MPESA_RETAILER_INITIATOR_NAME',
    'MPESA_RETAILER_INITIATOR_PASSWORD',
    'MPESA_RETAILER_CALLBACK_URL',
    'MPESA_RETAILER_PAYASSURE_SHORTCODE',
  ];
  const previousEnv = new Map(envNames.map((name) => [name, process.env[name]]));
  const previousMakeRequest = (mpesaService as any).makeRequest;

  try {
    process.env.MPESA_RETAILER_ENVIRONMENT = 'sandbox';
    process.env.MPESA_RETAILER_CONSUMER_KEY = 'retailer-key';
    process.env.MPESA_RETAILER_CONSUMER_SECRET = 'retailer-secret';
    process.env.MPESA_RETAILER_SHORTCODE = '600001';
    process.env.MPESA_RETAILER_PARTY_A = '600001';
    process.env.MPESA_RETAILER_INITIATOR_NAME = 'retailer-initiator';
    process.env.MPESA_RETAILER_INITIATOR_PASSWORD = 'retailer-password';
    process.env.MPESA_RETAILER_CALLBACK_URL = 'https://example.test/retailer';
    process.env.MPESA_RETAILER_PAYASSURE_SHORTCODE = '600002';

    let endpoint = '';
    let payload: Record<string, unknown> = {};
    let credentials: Record<string, unknown> = {};
    (mpesaService as any).makeRequest = async (
      nextEndpoint: string,
      nextPayload: Record<string, unknown>,
      nextCredentials: Record<string, unknown>,
    ) => {
      endpoint = nextEndpoint;
      payload = nextPayload;
      credentials = nextCredentials;
      return {
        ResponseCode: '0',
        ResponseDescription: 'Accepted',
        OriginatorConversationID: 'retailer-originator',
        ConversationID: 'retailer-conversation',
      };
    };

    const result = await retailerEscrowB2bService.transferToPayAssure({
      amount: 125,
      merchantTransactionReference: 'TXN-ESCROW-1',
      callbackPath: 'escrow-transfer/transfer-1',
      timeoutCallbackPath: 'escrow-transfer-timeout/transfer-1',
    });

    assert.equal(endpoint, 'b2b');
    assert.equal(payload.Initiator, 'retailer-initiator');
    assert.equal(payload.PartyA, '600001');
    assert.equal(payload.PartyB, '600002');
    assert.equal(payload.Amount, 125);
    assert.equal(payload.AccountReference, 'TXN-ESCROW-1');
    assert.equal(payload.QueueTimeOutURL, 'https://example.test/retailer/payments/callbacks/mpesa/escrow-transfer-timeout/transfer-1');
    assert.equal(payload.ResultURL, 'https://example.test/retailer/payments/callbacks/mpesa/escrow-transfer/transfer-1');
    assert.equal(credentials.consumerKey, 'retailer-key');
    assert.equal(credentials.consumerSecret, 'retailer-secret');
    assert.equal(result.success, true);
    assert.equal(result.conversationId, 'retailer-conversation');
  } finally {
    (mpesaService as any).makeRequest = previousMakeRequest;
    for (const [name, value] of previousEnv) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  }
});