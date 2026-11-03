import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { b2TillService } from './services/b2till.service';
import { mpesaService } from './services/mpesa.service';
import DispatchB2TillPayoutDto from './dto/dispatch-b2till-payout.dto';

test('B2Till sends a BusinessBuyGoods request to the B2B gateway', async () => {
  const originalMakeRequest = mpesaService.makeRequest.bind(mpesaService);
  const envKeys = [
    'MPESA_INITIATOR_NAME',
    'MPESA_INITIATOR_PASSWORD',
    'MPESA_PARTYA',
    'MPESA_SHORTCODE',
    'MPESA_CALLBACK_URL',
    'MPESA_B2TILL_QUEUE_TIMEOUT_URL',
    'MPESA_B2TILL_RESULT_URL',
  ] as const;
  const originalEnv = Object.fromEntries(envKeys.map((key) => [key, process.env[key]]));
  Object.assign(process.env, {
    MPESA_INITIATOR_NAME: 'API_Username',
    MPESA_INITIATOR_PASSWORD: 'test-initiator-password',
    MPESA_PARTYA: '123456',
    MPESA_B2TILL_QUEUE_TIMEOUT_URL: 'https://mydomain.com/b2b/businessbuygoods/queue/',
    MPESA_B2TILL_RESULT_URL: 'https://mydomain.com/b2b/businessbuygoods/result/',
  });
  mpesaService.makeRequest = async (endpoint, payload) => {
    assert.equal(endpoint, 'b2b');
    assert.equal(payload.Initiator, 'API_Username');
    assert.equal(typeof payload.SecurityCredential, 'string');
    assert.notEqual(payload.SecurityCredential, 'test-initiator-password');
    assert.equal(payload.CommandID, 'BusinessBuyGoods');
    assert.equal(payload.SenderIdentifierType, '4');
    assert.equal(payload.RecieverIdentifierType, '4');
    assert.equal(payload.Amount, '239');
    assert.equal(payload.PartyA, '123456');
    assert.equal(payload.PartyB, '000000');
    assert.equal(payload.AccountReference, '353353');
    assert.equal(payload.Requester, '254700000000');
    assert.equal(payload.Remarks, 'OK');
    assert.equal(payload.QueueTimeOutURL, 'https://mydomain.com/b2b/businessbuygoods/queue/');
    assert.equal(payload.ResultURL, 'https://mydomain.com/b2b/businessbuygoods/result/');
    assert.deepEqual(Object.keys(payload).sort(), [
      'AccountReference',
      'Amount',
      'CommandID',
      'Initiator',
      'PartyA',
      'PartyB',
      'QueueTimeOutURL',
      'RecieverIdentifierType',
      'Remarks',
      'Requester',
      'ResultURL',
      'SecurityCredential',
      'SenderIdentifierType',
    ].sort());

    return { ResponseCode: '0', ResponseDescription: 'Accepted' };
  };

  try {
    const request = Object.assign(new DispatchB2TillPayoutDto(), {
      Amount: '239',
      PartyB: '000000',
      AccountReference: '353353',
      Requester: '254700000000',
      Remarks: 'OK',
    });
    const response = await b2TillService.initiateB2Till(request);

    assert.equal(response.responseCode, '0');
    assert.equal(response.success, true);
  } finally {
    mpesaService.makeRequest = originalMakeRequest;
    for (const key of envKeys) {
      const value = originalEnv[key];
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});
