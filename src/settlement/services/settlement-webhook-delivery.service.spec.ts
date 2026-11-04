import { createHmac } from 'crypto';
import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import { SettlementWebhookDeliveryService } from './settlement-webhook-delivery.service';

test('settlement webhook delivery signs and sends events to retailer and supplier endpoints', async () => {
  const secret = 'integration-secret';
  const calls: Array<{ url: string; headers: Headers; body: string }> = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    calls.push({
      url: String(input),
      headers: new Headers(init?.headers),
      body: String(init?.body),
    });
    return new Response(null, { status: 204 });
  }) as typeof fetch;

  const prisma = {
    settlement: {
      findUnique: async () => ({
        id: 'settlement-1',
        businessId: 'retailer-1',
        integrationId: 'retailer-integration',
        reference: 'SET-1',
        merchantTransactionReference: 'ORDER-1',
        amount: 1000,
        currency: 'KES',
        status: 'PROCESSING',
        metadata: {
          fundingPlan: { cashAmount: 100, mpesaAmount: 0 },
          escrowFunding: { cashAmount: 100, payoutSource: 'CENTRAL_ACCOUNT' },
        },
        paymentPayload: { suppliers: [{ supplierMerchantId: 'supplier-merchant' }] },
        transactions: [],
      }),
    },
    integration: {
      findUnique: async () => ({
        merchantId: 'retailer-merchant',
        apiSecret: secret,
        webhookUrl: 'https://retailer.example/events',
        participantId: 'retailer-1',
        participant: { id: 'retailer-1', participantType: 'RETAILER', webhookUrl: null },
      }),
      findMany: async () => [{
        merchantId: 'supplier-merchant',
        apiSecret: secret,
        webhookUrl: null,
        participant: {
          id: 'supplier-1',
          participantType: 'SUPPLIER',
          webhookUrl: 'https://supplier.example/events',
        },
      }],
    },
    onboardingParticipant: {
      findUnique: async () => null,
    },
    b2BPayoutAttempt: {
      findMany: async () => [
        { party: 'RETAILER', recipientMerchantId: 'retailer-merchant', amount: 100, status: 'COMPLETED', payoutReference: 'retailer-payout', updatedAt: new Date() },
        { party: 'SUPPLIER', recipientMerchantId: 'supplier-merchant', amount: 800, status: 'PENDING', payoutReference: 'supplier-payout', updatedAt: new Date() },
      ],
    },
  } as any;

  try {
    const service = new SettlementWebhookDeliveryService(prisma);
    await service.notify('settlement-1', 'payment.collection.succeeded', { status: 'PAID' });

    assert.equal(calls.length, 2);
    for (const call of calls) {
      assert.match(call.url, /^https:\/\/(retailer|supplier)\.example\/events$/);
      const body = JSON.parse(call.body);
      const timestamp = call.headers.get('x-payassure-timestamp');
      const signature = call.headers.get('x-payassure-signature');
      assert.equal(call.headers.get('x-payassure-event'), 'payment.collection.succeeded');
      assert.equal(call.headers.get('x-payassure-event-id'), body.id);
      assert.equal(signature, `t=${timestamp},v1=${createHmac('sha256', secret).update(`${timestamp}.${call.body}`).digest('hex')}`);
      assert.equal(body.data.settlement.merchant_transaction_reference, 'ORDER-1');
      assert.equal(body.data.details.status, 'PAID');
      assert.deepEqual(body.data.cash_funding, {
        amount: 100,
        currency: 'KES',
        source: 'RETAILER_VIRTUAL_BALANCE',
      });
      assert.equal('availableBalance' in body.data.cash_funding, false);
      assert.equal('remainingBalance' in body.data.cash_funding, false);
      if (call.url.startsWith('https://supplier.')) {
        assert.equal(body.data.payouts.length, 1);
        assert.equal(body.data.payouts[0].merchant_id, 'supplier-merchant');
      } else {
        assert.equal(body.data.payouts.length, 2);
      }
    }
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('settlement webhook omits cash funding details before a mixed payment cash balance is reserved', async () => {
  const calls: string[] = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (_input: string | URL | Request, init?: RequestInit) => {
    calls.push(String(init?.body));
    return new Response(null, { status: 204 });
  }) as typeof fetch;
  const prisma = {
    settlement: {
      findUnique: async () => ({
        id: 'settlement-3',
        businessId: 'retailer-3',
        integrationId: 'retailer-integration-3',
        reference: 'SET-3',
        merchantTransactionReference: 'ORDER-3',
        amount: 25,
        currency: 'KES',
        status: 'PROCESSING',
        metadata: {
          fundingPlan: { cashAmount: 10, mpesaAmount: 15, cashStatus: 'WAITING_FOR_MPESA' },
        },
        paymentPayload: { suppliers: [] },
        transactions: [],
      }),
    },
    integration: {
      findUnique: async () => ({
        merchantId: 'retailer-merchant-3',
        apiSecret: 'integration-secret',
        webhookUrl: 'https://retailer.example/events',
        participantId: 'retailer-3',
        participant: { id: 'retailer-3', participantType: 'RETAILER', webhookUrl: null },
      }),
      findMany: async () => [],
    },
    onboardingParticipant: { findUnique: async () => null },
    b2BPayoutAttempt: { findMany: async () => [] },
  } as any;

  try {
    const service = new SettlementWebhookDeliveryService(prisma);
    await service.notify('settlement-3', 'payment.settlement.progress');
    assert.equal(calls.length, 1);
    assert.equal('cash_funding' in JSON.parse(calls[0]).data, false);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('settlement webhook does not retry a receiver 405 response', async () => {
  let attempts = 0;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async () => {
    attempts += 1;
    return new Response(null, { status: 405 });
  }) as typeof fetch;
  const prisma = {
    settlement: {
      findUnique: async () => ({
        id: 'settlement-4',
        businessId: 'retailer-4',
        integrationId: 'retailer-integration-4',
        reference: 'SET-4',
        merchantTransactionReference: 'ORDER-4',
        amount: 25,
        currency: 'KES',
        status: 'PROCESSING',
        metadata: {},
        paymentPayload: { suppliers: [] },
        transactions: [],
      }),
    },
    integration: {
      findUnique: async () => ({
        merchantId: 'retailer-merchant-4',
        apiSecret: 'integration-secret',
        webhookUrl: 'https://retailer.example/events',
        participantId: 'retailer-4',
        participant: { id: 'retailer-4', participantType: 'RETAILER', webhookUrl: null },
      }),
      findMany: async () => [],
    },
    onboardingParticipant: { findUnique: async () => null },
    b2BPayoutAttempt: { findMany: async () => [] },
  } as any;

  try {
    const service = new SettlementWebhookDeliveryService(prisma);
    await service.notify('settlement-4', 'payment.settlement.progress');
    assert.equal(attempts, 1);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('settlement webhook delivery refuses non-HTTPS destinations', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async () => {
    throw new Error('fetch must not be called for an HTTP destination');
  }) as typeof fetch;
  const prisma = {
    settlement: {
      findUnique: async () => ({
        id: 'settlement-2',
        businessId: 'retailer-2',
        integrationId: 'retailer-integration-2',
        reference: 'SET-2',
        merchantTransactionReference: 'ORDER-2',
        amount: 25,
        currency: 'KES',
        status: 'INITIATED',
        paymentPayload: { suppliers: [] },
        transactions: [],
      }),
    },
    integration: {
      findUnique: async () => ({
        merchantId: 'retailer-merchant-2',
        apiSecret: 'integration-secret',
        webhookUrl: 'http://retailer.example/events',
        participantId: 'retailer-2',
        participant: { id: 'retailer-2', participantType: 'RETAILER', webhookUrl: null },
      }),
      findMany: async () => [],
    },
    onboardingParticipant: { findUnique: async () => null },
    b2BPayoutAttempt: { findMany: async () => [] },
  } as any;

  try {
    const service = new SettlementWebhookDeliveryService(prisma);
    await service.notify('settlement-2', 'payment.collection.failed');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('webhook transport errors include nested network diagnostics', () => {
  const service = new SettlementWebhookDeliveryService({} as any);
  const networkError = Object.assign(new Error('getaddrinfo ENOTFOUND webhook.example'), {
    code: 'ENOTFOUND',
    syscall: 'getaddrinfo',
    hostname: 'webhook.example',
  });
  const fetchError = Object.assign(new TypeError('fetch failed'), { cause: networkError });

  assert.match((service as any).errorMessage(fetchError), /ENOTFOUND/);
  assert.match((service as any).errorMessage(fetchError), /webhook\.example/);
});
