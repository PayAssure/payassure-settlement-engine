import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { MpesaService } from './services/mpesa.service';

test('B2Pochi payout request is built with the documented Safaricom fields', async () => {
  const service = new MpesaService();

  (service as any).makeRequest = async (endpoint: string, payload: Record<string, unknown>) => {
    assert.equal(endpoint, 'b2pochi');
    assert.equal(payload.OriginatorConversationID, '600997_Test_32et3241ed8yu');
    assert.equal(payload.InitiatorName, 'testapi');
    assert.equal(payload.SecurityCredential, 'encrypted-credential');
    assert.equal(payload.CommandID, 'BusinessPayToPochi');
    assert.equal(payload.Amount, '10');
    assert.equal(payload.PartyA, '600997');
    assert.equal(payload.PartyB, 254705912645);
    assert.equal(typeof payload.PartyB, 'number');
    assert.equal(payload.Remarks, 'remarked');
    assert.equal(payload.ResultURL, 'https://mydomain.com/b2c/result');
    assert.equal(payload.QueueTimeOutURL, 'https://mydomain.com/b2c/timedout');
    assert.equal(payload.Occassion, 'ChristmasPay');

    return {
      ResponseCode: '0',
      ResponseDescription: 'Accept the service request successfully.',
    };
  };

  const response = await service.dispatchB2PochiPayment({
    OriginatorConversationID: '600997_Test_32et3241ed8yu',
    InitiatorName: 'testapi',
    SecurityCredential: 'encrypted-credential',
    CommandID: 'BusinessPayToPochi',
    Amount: '10',
    PartyA: '600997',
    PartyB: 254705912645,
    Remarks: 'remarked',
    QueueTimeOutURL: 'https://mydomain.com/b2c/timedout',
    ResultURL: 'https://mydomain.com/b2c/result',
    Occassion: 'ChristmasPay',
  });

  assert.equal(response.responseCode, '0');
  assert.equal(response.responseDescription, 'Accept the service request successfully.');
});
