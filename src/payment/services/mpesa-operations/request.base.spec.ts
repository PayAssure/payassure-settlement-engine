import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { MpesaService } from '../mpesa.service';
import type { PaymentRequestLog } from './types';

class TestMpesaService extends MpesaService {
  protected override async logRequest(_entry: PaymentRequestLog): Promise<void> {}
}

test('retries an invalid token using the replacement token in the Authorization header', async () => {
  const originalFetch = globalThis.fetch;
  const oauthTokens = ['first-access-token', 'replacement-access-token'];
  const apiRequests: Array<{ url: string; authorization: string | undefined }> = [];
  let oauthRequestCount = 0;

  globalThis.fetch = async (input, init) => {
    const url = String(input);
    if (url.includes('/oauth/v1/generate')) {
      const token = oauthTokens[oauthRequestCount++];
      return new Response(JSON.stringify({ access_token: token }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const headers = init?.headers as Record<string, string> | undefined;
    apiRequests.push({ url, authorization: headers?.Authorization });
    if (apiRequests.length === 1) {
      return new Response(JSON.stringify({
        errorCode: '404.001.03',
        errorMessage: 'Invalid Access Token',
      }), {
        status: 404,
        statusText: 'Not Found',
        headers: { 'Content-Type': 'application/json' },
      });
    }

    return new Response(JSON.stringify({ ResponseCode: '0' }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  };

  try {
    const response = await new TestMpesaService().makeRequest(
      'account_balance',
      { CommandID: 'AccountBalance' },
      {
        environment: 'production',
        consumerKey: 'test-consumer-key',
        consumerSecret: 'test-consumer-secret',
      },
    );

    assert.equal(response.ResponseCode, '0');
    assert.equal(oauthRequestCount, 2);
    assert.deepEqual(apiRequests, [
      {
        url: 'https://api.safaricom.co.ke/mpesa/accountbalance/v1/query',
        authorization: 'Bearer first-access-token',
      },
      {
        url: 'https://api.safaricom.co.ke/mpesa/accountbalance/v1/query',
        authorization: 'Bearer replacement-access-token',
      },
    ]);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('preserves the final Safaricom invalid-token response after the replacement token is rejected', async () => {
  const originalFetch = globalThis.fetch;
  const oauthTokens = ['first-access-token', 'replacement-access-token'];
  const apiAuthorizations: Array<string | undefined> = [];
  let oauthRequestCount = 0;
  let apiRequestCount = 0;

  globalThis.fetch = async (input, init) => {
    if (String(input).includes('/oauth/v1/generate')) {
      return new Response(JSON.stringify({ access_token: oauthTokens[oauthRequestCount++] }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    apiRequestCount += 1;
    const headers = init?.headers as Record<string, string> | undefined;
    apiAuthorizations.push(headers?.Authorization);
    return new Response(JSON.stringify({
      requestId: 'safaricom-request-id',
      errorCode: '404.001.03',
      errorMessage: 'Invalid Access Token',
    }), {
      status: 404,
      statusText: 'Not Found',
      headers: { 'Content-Type': 'application/json' },
    });
  };

  try {
    await assert.rejects(
      new TestMpesaService().makeRequest(
        'account_balance',
        { CommandID: 'AccountBalance' },
        {
          environment: 'production',
          consumerKey: 'test-consumer-key',
          consumerSecret: 'test-consumer-secret',
        },
      ),
      /safaricom-request-id.*404\.001\.03.*Invalid Access Token/,
    );

    assert.equal(oauthRequestCount, 2);
    assert.equal(apiRequestCount, 2);
    assert.deepEqual(apiAuthorizations, [
      'Bearer first-access-token',
      'Bearer replacement-access-token',
    ]);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
