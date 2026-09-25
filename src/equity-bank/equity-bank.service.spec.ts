import { strict as assert } from 'node:assert';
import { createPublicKey, createVerify } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { EquityBankService } from './equity-bank.service';

const source = { countryCode: 'KE', name: 'John Doe', accountNumber: '00013XXXX6836' };
const destination = { type: 'bank', countryCode: 'KE', name: 'Tom Doe', bankCode: '57', accountNumber: '00201XXXX4605' };
const transfer = { type: 'EFT', amount: '500.00', currencyCode: 'KES', reference: '192112602006', date: '2023-10-13', description: 'Some remarks here' };
const request = { source, destination, transfer };

test('logs the raw payload and credentials in debug mode for troubleshooting', async () => {
  const previousDebug = process.env.EQUITY_BANK_DEBUG_LOGGING;
  const previousEnvironment = process.env.EQUITY_BANK_ENVIRONMENT;
  const previousApiKey = process.env.EQUITY_BANK_API_KEY;
  const previousMerchant = process.env.EQUITY_BANK_MERCHANT_CODE;
  const previousSecret = process.env.EQUITY_BANK_CONSUMER_SECRET;
  const previousFetch = global.fetch;

  process.env.EQUITY_BANK_DEBUG_LOGGING = 'true';
  process.env.EQUITY_BANK_ENVIRONMENT = 'uat';
  process.env.EQUITY_BANK_API_KEY = 'api-key';
  process.env.EQUITY_BANK_MERCHANT_CODE = 'merchant';
  process.env.EQUITY_BANK_CONSUMER_SECRET = 'consumer-secret';
  global.fetch = (async () => new Response(JSON.stringify({ accessToken: 'access-token' }), { status: 200 })) as typeof fetch;

  try {
    const service = new EquityBankService();
    const captured: string[] = [];
    service['logger'].log = (...args: unknown[]) => {
      captured.push(args.join(' '));
    };

    await service.getAccountBalance({ countryCode: 'KE', accountId: '00201XXXX14605', date: '2023-10-13' });

    assert.equal(captured.some((entry) => entry.includes('"Api-Key":"api-key"')), true);
    assert.equal(captured.some((entry) => entry.includes('"consumerSecret":"consumer-secret"')), true);
    assert.equal(captured.some((entry) => entry.includes('"accessToken":"access-token"')), true);
    assert.equal(captured.some((entry) => entry.includes('"merchantCode":"merchant"')), true);
  } finally {
    global.fetch = previousFetch;
    for (const [key, value] of Object.entries({
      EQUITY_BANK_DEBUG_LOGGING: previousDebug,
      EQUITY_BANK_ENVIRONMENT: previousEnvironment,
      EQUITY_BANK_API_KEY: previousApiKey,
      EQUITY_BANK_MERCHANT_CODE: previousMerchant,
      EQUITY_BANK_CONSUMER_SECRET: previousSecret,
    })) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});

test('calls all Equity Bank APIs with the documented RSA signatures and response bodies', async () => {
  const publicKey = createPublicKey(readFileSync('privatekey.pem', 'utf8'));
  const previousEnvironment = process.env.EQUITY_BANK_ENVIRONMENT;
  const previousApiKey = process.env.EQUITY_BANK_API_KEY;
  const previousMerchant = process.env.EQUITY_BANK_MERCHANT_CODE;
  const previousSecret = process.env.EQUITY_BANK_CONSUMER_SECRET;
  const previousFetch = global.fetch;
  const calls: Array<{ url: string; init?: RequestInit }> = [];

  process.env.EQUITY_BANK_ENVIRONMENT = 'uat';
  process.env.EQUITY_BANK_API_KEY = 'api-key';
  process.env.EQUITY_BANK_MERCHANT_CODE = 'merchant';
  process.env.EQUITY_BANK_CONSUMER_SECRET = 'consumer-secret';
  global.fetch = (async (url: string | URL, init?: RequestInit) => {
    calls.push({ url: String(url), init });
    if (String(url).includes('/authentication/')) return new Response(JSON.stringify({ accessToken: 'access-token' }), { status: 200 });
    return new Response(JSON.stringify({ status: true, code: 0, message: 'success', data: { transactionId: 'tx-1', status: 'SUCCESS' } }), { status: 200 });
  }) as typeof fetch;

  const verifySignature = (value: string, signature: string) => {
    const verifier = createVerify('RSA-SHA256');
    verifier.update(value, 'utf8');
    assert.equal(verifier.verify(publicKey, Buffer.from(signature, 'base64')), true);
  };

  try {
    const service = new EquityBankService();
    const balance = await service.getAccountBalance({ countryCode: 'KE', accountId: '00201XXXX14605', date: '2023-10-13' });
    await service.internalBankTransfer(request);
    await service.pesalinkBankTransfer(request);
    await service.pesalinkMobileTransfer({ ...request, destination: { ...destination, type: 'mobile', mobileNumber: '0722000000' } });

    assert.equal((balance.data as { transactionId: string }).transactionId, 'tx-1');
    assert.equal(calls.length, 8);
    assert.equal((calls[0].init?.headers as Record<string, string>)['Api-Key'], 'api-key');
    assert.deepEqual(JSON.parse(String(calls[0].init?.body)), {
      merchantCode: 'merchant',
      consumerSecret: 'consumer-secret',
    });
    assert.equal(calls[1].url, 'https://uat.finserve.africa/v3-apis/account-api/v3.0/accounts/balances/KE/00201XXXX14605');
    assert.equal(calls[3].url, 'https://uat.finserve.africa/v3-apis/transaction-api/v3.0/remittance/internalBankTransfer');
    assert.equal(calls[5].url, 'https://uat.finserve.africa/v3-apis/transaction-api/v3.0/remittance/pesalinkacc');
    assert.equal(calls[7].url, 'https://uat.finserve.africa/v3-apis/transaction-api/v3.0/remittance/pesalinkMobile');
    assert.equal((calls[1].init?.headers as Record<string, string>).Authorization, 'Bearer access-token');
    verifySignature('00201XXXX14605KE2023-10-13', String((calls[1].init?.headers as Record<string, string>).Signature));
    verifySignature('00013XXXX6836500.00KES192112602006', String((calls[3].init?.headers as Record<string, string>).Signature));
    verifySignature('500.00KES192112602006Tom Doe00013XXXX6836', String((calls[5].init?.headers as Record<string, string>).Signature));
    assert.deepEqual(JSON.parse(String(calls[3].init?.body)), request);
  } finally {
    global.fetch = previousFetch;
    for (const [key, value] of Object.entries({
      EQUITY_BANK_ENVIRONMENT: previousEnvironment,
      EQUITY_BANK_API_KEY: previousApiKey,
      EQUITY_BANK_MERCHANT_CODE: previousMerchant,
      EQUITY_BANK_CONSUMER_SECRET: previousSecret,
    })) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});