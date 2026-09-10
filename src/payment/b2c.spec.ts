import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { mpesaService } from './services/mpesa.service';
import { b2cService } from './services/b2c.service';

test('B2C payment request is built with the documented Safaricom fields', async () => {
  const originalMakeRequest = mpesaService.makeRequest.bind(mpesaService);

  (mpesaService as any).makeRequest = async (endpoint: string, payload: Record<string, unknown>) => {
    assert.equal(endpoint, 'b2c');
    assert.equal(payload.OriginatorConversationID, '600997_Test_32et3241ed8yu');
    assert.equal(payload.InitiatorName, process.env.MPESA_INITIATOR_NAME);
    assert.equal(typeof payload.SecurityCredential, 'string');
    assert.ok(String(payload.SecurityCredential).length > 0);
    assert.equal(payload.CommandID, 'BusinessPayment');
    assert.equal(payload.Amount, '10');
    assert.equal(payload.PartyA, process.env.MPESA_PARTYA);
    assert.equal(payload.PartyB, '254705912645');
    assert.equal(payload.Remarks, 'remarked');
    assert.equal(payload.QueueTimeOutURL, 'https://mydomain.com/callbacks/mpesa');
    assert.equal(payload.ResultURL, 'https://mydomain.com/callbacks/mpesa');
    assert.equal(payload.Occassion, 'ChristmasPay');

    return {
      ResponseCode: '0',
      ResponseDescription: 'Accept the service request successfully.',
    };
  };

  const response = await b2cService.initiateB2C({
    OriginatorConversationID: '600997_Test_32et3241ed8yu',
    CommandID: 'BusinessPayment',
    Amount: 10,
    PartyB: 254705912645,
    Remarks: 'remarked',
    callbackUrl: 'https://mydomain.com',
    Occassion: 'ChristmasPay',
  });

  assert.equal(response.responseCode, '0');
  assert.equal(response.responseDescription, 'Accept the service request successfully.');
  (mpesaService as any).makeRequest = originalMakeRequest;
});
