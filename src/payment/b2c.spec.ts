import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { mpesaService } from './services/mpesa.service';
import { b2cService } from './services/b2c.service';

test('B2C payment request is built with the documented Safaricom fields', async () => {
  const originalMakeRequest = mpesaService.makeRequest.bind(mpesaService);
  const partyBNumbers: string[] = [];

  (mpesaService as any).makeRequest = async (endpoint: string, payload: Record<string, unknown>) => {
    assert.equal(endpoint, 'b2c');
    partyBNumbers.push(String(payload.PartyB));

    return {
      ResponseCode: '0',
      ResponseDescription: 'Accept the service request successfully.',
    };
  };

  try {
    const response = await b2cService.initiateB2C({
      OriginatorConversationID: '600997_Test_32et3241ed8yu',
      CommandID: 'BusinessPayment',
      Amount: 10,
      PartyB: 254705912645,
      Remarks: 'remarked',
      Occassion: 'ChristmasPay',
    });
    await b2cService.initiateB2C({ PartyB: '0791614036' });
    await b2cService.initiateB2C({ PartyB: '+254791614036' });

    assert.equal(response.responseCode, '0');
    assert.equal(response.responseDescription, 'Accept the service request successfully.');
    assert.deepEqual(partyBNumbers, ['254705912645', '254791614036', '254791614036']);
  } finally {
    (mpesaService as any).makeRequest = originalMakeRequest;
  }
});
