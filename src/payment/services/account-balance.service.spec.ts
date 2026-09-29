import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import { accountBalanceService } from './account-balance.service';
import { mpesaService } from './mpesa.service';

test('account balance request uses the provided callback URLs and Safaricom payload contract', async () => {
  const previousCallbackUrl = process.env.MPESA_CALLBACK_URL;
  const previousInitiator = process.env.MPESA_INITIATOR_NAME;
  const previousPartyA = process.env.MPESA_PARTYA;
  const previousShortcode = process.env.MPESA_SHORTCODE;
  const previousMakeRequest = (mpesaService as any).makeRequest;

  try {
    process.env.MPESA_CALLBACK_URL = 'https://example.test/hook';
    process.env.MPESA_INITIATOR_NAME = 'testapiuser';
    process.env.MPESA_PARTYA = '600000';
    process.env.MPESA_SHORTCODE = '600000';

    let payload: any;
    (mpesaService as any).makeRequest = async (_endpoint: string, nextPayload: Record<string, unknown>) => {
      payload = nextPayload;
      return {
        OriginatorConversationID: 'ocid-123',
        ConversationID: 'cid-123',
        ResponseCode: '0',
        ResponseDescription: 'Accept the service request successfully',
      };
    };

    const result = await accountBalanceService.queryAccountBalance({
      resultRoute: 'escrow-balance/transfer-123',
      timeoutRoute: 'escrow-balance-timeout/transfer-123',
    });

    assert.equal(payload.Initiator, 'testapiuser');
    assert.equal(payload.CommandID, 'AccountBalance');
    assert.equal(payload.PartyA, '600000');
    assert.equal(payload.IdentifierType, '4');
    assert.equal(payload.QueueTimeOutURL, 'https://example.test/hook/callbacks/mpesa/escrow-balance-timeout/transfer-123');
    assert.equal(payload.ResultURL, 'https://example.test/hook/callbacks/mpesa/escrow-balance/transfer-123');
    assert.equal(result.ResponseCode, '0');
    assert.equal(result.ResponseDescription, 'Accept the service request successfully');
  } finally {
    (mpesaService as any).makeRequest = previousMakeRequest;
    if (previousCallbackUrl === undefined) delete process.env.MPESA_CALLBACK_URL; else process.env.MPESA_CALLBACK_URL = previousCallbackUrl;
    if (previousInitiator === undefined) delete process.env.MPESA_INITIATOR_NAME; else process.env.MPESA_INITIATOR_NAME = previousInitiator;
    if (previousPartyA === undefined) delete process.env.MPESA_PARTYA; else process.env.MPESA_PARTYA = previousPartyA;
    if (previousShortcode === undefined) delete process.env.MPESA_SHORTCODE; else process.env.MPESA_SHORTCODE = previousShortcode;
  }
});