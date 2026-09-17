import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { KcbService } from './kcb.service';

const transferRequest = {
  beneficiaryDetails: 'JOHN DOE',
  companyCode: 'KE0010001',
  creditAccountNumber: '1279287799',
  currency: 'KES',
  debitAccountNumber: '1279258233',
  debitAmount: 26,
  paymentDetails: 'UT Fund withdrawal',
  transactionReference: 'FT1234567890',
  transactionType: 'IF',
  beneficiaryBankCode: '01',
};

test('authenticates with KCB and sends the standalone funds transfer payload', async () => {
  const previous = {
    baseUrl: process.env.KCB_BASE_URL,
    tokenUrl: process.env.KCB_TOKEN_URL,
    transferUrl: process.env.KCB_FUNDS_TRANSFER_URL,
    consumerKey: process.env.KCB_CONSUMER_KEY,
    consumerSecret: process.env.KCB_CONSUMER_SECRET,
  };
  process.env.KCB_TOKEN_URL = 'https://kcb.test/token';
  process.env.KCB_FUNDS_TRANSFER_URL = 'https://kcb.test/transfer';
  process.env.KCB_CONSUMER_KEY = 'consumer-key';
  process.env.KCB_CONSUMER_SECRET = 'consumer-secret';

  const calls: Array<{ url: string; init?: RequestInit }> = [];
  const previousFetch = global.fetch;
  global.fetch = (async (url: string | URL, init?: RequestInit) => {
    calls.push({ url: String(url), init });
    if (String(url) === 'https://kcb.test/token') {
      return new Response(JSON.stringify({ access_token: 'kcb-access-token', token_type: 'Bearer' }), { status: 200 });
    }
    return new Response(JSON.stringify({ transactionStatus: 'ACCEPTED' }), { status: 200 });
  }) as typeof fetch;

  try {
    const result = await new KcbService().initiateFundsTransfer(transferRequest);

    assert.equal(result.success, true);
    assert.equal(calls.length, 2);
    assert.equal(calls[0].init?.method, 'POST');
    assert.match(String((calls[0].init?.headers as Record<string, string>).Authorization), /^Basic /);
    assert.equal(calls[1].init?.headers && (calls[1].init?.headers as Record<string, string>).Authorization, 'Bearer kcb-access-token');
    assert.deepEqual(JSON.parse(String(calls[1].init?.body)), transferRequest);
  } finally {
    global.fetch = previousFetch;
    for (const [key, value] of Object.entries(previous)) {
      const envKey = key === 'baseUrl' ? 'KCB_BASE_URL' : key === 'tokenUrl' ? 'KCB_TOKEN_URL' : key === 'transferUrl' ? 'KCB_FUNDS_TRANSFER_URL' : key === 'consumerKey' ? 'KCB_CONSUMER_KEY' : 'KCB_CONSUMER_SECRET';
      if (value === undefined) delete process.env[envKey];
      else process.env[envKey] = value;
    }
  }
});

test('passes the authorization scheme returned by KCB to the funds transfer request', async () => {
  const previous = {
    tokenUrl: process.env.KCB_TOKEN_URL,
    transferUrl: process.env.KCB_FUNDS_TRANSFER_URL,
    consumerKey: process.env.KCB_CONSUMER_KEY,
    consumerSecret: process.env.KCB_CONSUMER_SECRET,
  };
  process.env.KCB_TOKEN_URL = 'https://kcb.test/token';
  process.env.KCB_FUNDS_TRANSFER_URL = 'https://kcb.test/transfer';
  process.env.KCB_CONSUMER_KEY = 'consumer-key';
  process.env.KCB_CONSUMER_SECRET = 'consumer-secret';

  const calls: Array<{ url: string; init?: RequestInit }> = [];
  const previousFetch = global.fetch;
  global.fetch = (async (url: string | URL, init?: RequestInit) => {
    calls.push({ url: String(url), init });
    if (String(url) === 'https://kcb.test/token') {
      return new Response(JSON.stringify({ access_token: 'kcb-access-token', token_type: 'CustomScheme' }), { status: 200 });
    }
    return new Response(JSON.stringify({ statusCode: '0', statusMessage: 'Success' }), { status: 200 });
  }) as typeof fetch;

  try {
    await new KcbService().initiateFundsTransfer(transferRequest);
    assert.equal(
      (calls[1].init?.headers as Record<string, string>).Authorization,
      'CustomScheme kcb-access-token',
    );
  } finally {
    global.fetch = previousFetch;
    for (const [key, value] of Object.entries(previous)) {
      const envKey = key === 'tokenUrl' ? 'KCB_TOKEN_URL' : key === 'transferUrl' ? 'KCB_FUNDS_TRANSFER_URL' : key === 'consumerKey' ? 'KCB_CONSUMER_KEY' : 'KCB_CONSUMER_SECRET';
      if (value === undefined) delete process.env[envKey];
      else process.env[envKey] = value;
    }
  }
});

test('rejects a KCB business-level transfer error returned with HTTP 200', async () => {
  const previous = {
    tokenUrl: process.env.KCB_TOKEN_URL,
    transferUrl: process.env.KCB_FUNDS_TRANSFER_URL,
    consumerKey: process.env.KCB_CONSUMER_KEY,
    consumerSecret: process.env.KCB_CONSUMER_SECRET,
  };
  process.env.KCB_TOKEN_URL = 'https://kcb.test/token';
  process.env.KCB_FUNDS_TRANSFER_URL = 'https://kcb.test/transfer';
  process.env.KCB_CONSUMER_KEY = 'consumer-key';
  process.env.KCB_CONSUMER_SECRET = 'consumer-secret';

  const previousFetch = global.fetch;
  global.fetch = (async (url: string | URL) => {
    if (String(url) === 'https://kcb.test/token') {
      return new Response(JSON.stringify({ access_token: 'kcb-access-token' }), { status: 200 });
    }
    return new Response(JSON.stringify({
      statusCode: '1',
      statusMessage: 'Error',
      statusDescription: 'Validation failed: limit rule',
    }), { status: 200 });
  }) as typeof fetch;

  try {
    await assert.rejects(
      () => new KcbService().initiateFundsTransfer(transferRequest),
      /KCB funds transfer request failed/,
    );
  } finally {
    global.fetch = previousFetch;
    for (const [key, value] of Object.entries(previous)) {
      const envKey = key === 'tokenUrl' ? 'KCB_TOKEN_URL' : key === 'transferUrl' ? 'KCB_FUNDS_TRANSFER_URL' : key === 'consumerKey' ? 'KCB_CONSUMER_KEY' : 'KCB_CONSUMER_SECRET';
      if (value === undefined) delete process.env[envKey];
      else process.env[envKey] = value;
    }
  }
});

test('rejects KCB transfer when consumer credentials are missing', async () => {
  const previousKey = process.env.KCB_CONSUMER_KEY;
  const previousSecret = process.env.KCB_CONSUMER_SECRET;
  delete process.env.KCB_CONSUMER_KEY;
  delete process.env.KCB_CONSUMER_SECRET;

  try {
    await assert.rejects(
      () => new KcbService().initiateFundsTransfer(transferRequest),
      /KCB consumer credentials are not configured/,
    );
  } finally {
    if (previousKey === undefined) delete process.env.KCB_CONSUMER_KEY;
    else process.env.KCB_CONSUMER_KEY = previousKey;
    if (previousSecret === undefined) delete process.env.KCB_CONSUMER_SECRET;
    else process.env.KCB_CONSUMER_SECRET = previousSecret;
  }
});

test('rejects missing account configuration before contacting KCB', async () => {
  const previous = {
    companyCode: process.env.KCB_COMPANY_CODE,
    debitAccountNumber: process.env.KCB_DEBIT_ACCOUNT_NUMBER,
    consumerKey: process.env.KCB_CONSUMER_KEY,
    consumerSecret: process.env.KCB_CONSUMER_SECRET,
  };
  delete process.env.KCB_COMPANY_CODE;
  delete process.env.KCB_DEBIT_ACCOUNT_NUMBER;
  process.env.KCB_CONSUMER_KEY = 'consumer-key';
  process.env.KCB_CONSUMER_SECRET = 'consumer-secret';

  let fetchCalled = false;
  const previousFetch = global.fetch;
  global.fetch = (async () => {
    fetchCalled = true;
    return new Response('{}', { status: 200 });
  }) as typeof fetch;

  try {
    await assert.rejects(
      () => new KcbService().initiateFundsTransfer({ ...transferRequest, companyCode: undefined, debitAccountNumber: undefined }),
      /KCB configuration is missing: companyCode, debitAccountNumber/,
    );
    assert.equal(fetchCalled, false);
  } finally {
    global.fetch = previousFetch;
    for (const [key, value] of Object.entries(previous)) {
      const envKey = key === 'companyCode' ? 'KCB_COMPANY_CODE' : key === 'debitAccountNumber' ? 'KCB_DEBIT_ACCOUNT_NUMBER' : key === 'consumerKey' ? 'KCB_CONSUMER_KEY' : 'KCB_CONSUMER_SECRET';
      if (value === undefined) delete process.env[envKey];
      else process.env[envKey] = value;
    }
  }
});