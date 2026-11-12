import { createHmac } from 'crypto';
import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import { SettlementWebhookDeliveryService } from './settlement-webhook-delivery.service';

function createWebhookDeliveryStore() {
  const deliveries = new Map<string, any>();
  const attempts: any[] = [];
  const store: any = {
    settlementWebhookDelivery: {
      create: async ({ data }: any) => {
        const delivery = { id: `delivery-${deliveries.size + 1}`, attemptCount: 0, ...data };
        deliveries.set(delivery.id, delivery);
        return structuredClone(delivery);
      },
      findUnique: async ({ where }: any) => {
        const delivery = deliveries.get(where.id);
        return delivery ? structuredClone(delivery) : null;
      },
      findMany: async ({ where }: any) => Array.from(deliveries.values()).filter((delivery) => (
        delivery.status === where.status
        && (!where.nextAttemptAt?.lte || (delivery.nextAttemptAt && delivery.nextAttemptAt <= where.nextAttemptAt.lte))
      )),
      updateMany: async ({ where, data }: any) => {
        const delivery = deliveries.get(where.id);
        if (!delivery || (where.status?.in && !where.status.in.includes(delivery.status))) return { count: 0 };
        if (typeof where.status === 'string' && delivery.status !== where.status) return { count: 0 };
        const { attemptCount, ...fields } = data;
        Object.assign(delivery, fields);
        if (attemptCount?.increment) delivery.attemptCount += attemptCount.increment;
        else if (attemptCount !== undefined) delivery.attemptCount = attemptCount;
        return { count: 1 };
      },
    },
    settlementWebhookDeliveryAttempt: {
      create: async ({ data }: any) => {
        const attempt = { id: `attempt-${attempts.length + 1}`, ...data };
        attempts.push(attempt);
        return attempt;
      },
      updateMany: async ({ where, data }: any) => {
        const attempt = attempts.find((entry) => (
          entry.deliveryId === where.deliveryId && entry.attemptNumber === where.attemptNumber
        ));
        if (!attempt) return { count: 0 };
        Object.assign(attempt, data);
        return { count: 1 };
      },
    },
    $transaction: async (operation: (tx: any) => Promise<unknown>) => operation(store),
  };
  return { store, deliveries, attempts };
}

test('settlement webhook delivery sends only to the retailer endpoint and signs the event', async () => {
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

  const deliveryStore = createWebhookDeliveryStore();
  const prisma = {
    ...deliveryStore.store,
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
        id: 'retailer-integration',
        merchantId: 'retailer-merchant',
        apiSecret: secret,
        webhookUrl: 'https://retailer.example/events?site=store-1',
        participantId: 'retailer-1',
        participant: { id: 'retailer-1', participantType: 'RETAILER', webhookUrl: null },
      }),
      findMany: async () => {
        throw new Error('Supplier integrations must not be queried for webhook delivery');
      },
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

    assert.equal(calls.length, 1);
    const [call] = calls;
    assert.equal(call.url, 'https://retailer.example/events?site=store-1');
    const body = JSON.parse(call.body);
    const timestamp = call.headers.get('x-payassure-timestamp');
    const signature = call.headers.get('x-payassure-signature');
    assert.equal(call.headers.get('x-payassure-event'), 'payment.collection.succeeded');
    assert.equal(call.headers.get('x-payassure-event-id'), body.id);
    assert.equal(signature, `t=${timestamp},v1=${createHmac('sha256', secret).update(`${timestamp}.${call.body}`).digest('hex')}`);
    assert.equal(body.data.settlement.merchant_transaction_reference, 'ORDER-1');
    assert.equal(body.data.details.status, 'PAID');
    assert.equal(body.data.recipient.merchant_id, 'retailer-merchant');
    assert.equal(body.data.recipient.participant_type, 'RETAILER');
    assert.deepEqual(body.data.cash_funding, {
      amount: 100,
      currency: 'KES',
      source: 'RETAILER_VIRTUAL_BALANCE',
    });
    assert.equal('availableBalance' in body.data.cash_funding, false);
    assert.equal('remainingBalance' in body.data.cash_funding, false);
    assert.equal(body.data.payouts.length, 2);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('settlement webhook refuses a supplier as the settlement integration recipient', async () => {
  let fetchCalls = 0;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async () => {
    fetchCalls += 1;
    return new Response(null, { status: 204 });
  }) as typeof fetch;
  const prisma = {
    ...createWebhookDeliveryStore().store,
    settlement: {
      findUnique: async () => ({
        id: 'settlement-supplier-recipient',
        businessId: 'supplier-1',
        integrationId: 'supplier-integration',
        amount: 25,
        currency: 'KES',
        status: 'PROCESSING',
        metadata: {},
      }),
    },
    integration: {
      findUnique: async () => ({
        id: 'supplier-integration',
        merchantId: 'supplier-merchant',
        apiSecret: 'integration-secret',
        webhookUrl: 'https://supplier.example/events',
        participantId: 'supplier-1',
        participant: { id: 'supplier-1', participantType: 'SUPPLIER', webhookUrl: null },
      }),
    },
    onboardingParticipant: { findUnique: async () => null },
  } as any;

  try {
    const service = new SettlementWebhookDeliveryService(prisma);
    await service.notify('settlement-supplier-recipient', 'payment.collection.succeeded');
    assert.equal(fetchCalls, 0);
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
    ...createWebhookDeliveryStore().store,
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
        id: 'retailer-integration-3',
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
  const deliveryStore = createWebhookDeliveryStore();
  const prisma = {
    ...deliveryStore.store,
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
        id: 'retailer-integration-4',
        merchantId: 'retailer-merchant-4',
        apiSecret: 'integration-secret',
        webhookUrl: 'https://retailer.example/events?site=store-405',
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
    const [delivery] = Array.from(deliveryStore.deliveries.values());
    assert.equal(delivery.status, 'FAILED');
    assert.equal(delivery.lastResponseStatus, 405);
    assert.equal(delivery.endpoint, 'https://retailer.example/events?site=store-405');
    assert.equal(deliveryStore.attempts.length, 1);
    assert.equal(deliveryStore.attempts[0].responseStatus, 405);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('settlement webhook retries transient failures and preserves the event ID across attempts', async () => {
  const eventIds: string[] = [];
  let fetchCount = 0;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (_input: string | URL | Request, init?: RequestInit) => {
    fetchCount += 1;
    eventIds.push(new Headers(init?.headers).get('x-payassure-event-id') ?? '');
    return new Response(null, { status: fetchCount === 1 ? 503 : 204 });
  }) as typeof fetch;
  const deliveryStore = createWebhookDeliveryStore();
  const prisma = {
    ...deliveryStore.store,
    settlement: {
      findUnique: async () => ({
        id: 'settlement-retry',
        businessId: 'retailer-retry',
        integrationId: 'retailer-integration-retry',
        reference: 'SET-RETRY',
        merchantTransactionReference: 'ORDER-RETRY',
        amount: 25,
        currency: 'KES',
        status: 'PROCESSING',
        metadata: {},
      }),
    },
    integration: {
      findUnique: async () => ({
        id: 'retailer-integration-retry',
        merchantId: 'retailer-merchant-retry',
        apiSecret: 'integration-secret',
        webhookUrl: 'https://retailer.example/events',
        participantId: 'retailer-retry',
        participant: { id: 'retailer-retry', participantType: 'RETAILER', webhookUrl: null },
      }),
      findMany: async () => [],
    },
    onboardingParticipant: { findUnique: async () => null },
    b2BPayoutAttempt: { findMany: async () => [] },
  } as any;

  try {
    const service = new SettlementWebhookDeliveryService(prisma);
    await service.notify('settlement-retry', 'payment.settlement.progress');
    const [delivery] = Array.from(deliveryStore.deliveries.values());
    assert.equal(fetchCount, 2);
    assert.equal(eventIds[0], eventIds[1]);
    assert.equal(delivery.status, 'DELIVERED');
    assert.equal(delivery.attemptCount, 2);
    assert.equal(deliveryStore.attempts.length, 2);
    assert.equal(deliveryStore.attempts[0].responseStatus, 503);
    assert.equal(deliveryStore.attempts[1].responseStatus, 204);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('settlement webhook delivery allows HTTP destinations for development', async () => {
  const calls: string[] = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (input: string | URL | Request) => {
    calls.push(String(input));
    return new Response(null, { status: 204 });
  }) as typeof fetch;
  const prisma = {
    ...createWebhookDeliveryStore().store,
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
        webhookUrl: 'http://localhost:3010/webhook',
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
    assert.deepEqual(calls, ['http://localhost:3010/webhook']);
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

test('webhook retry processing skips when the delivery tables are not yet migrated', async () => {
  const service = new SettlementWebhookDeliveryService({
    settlementWebhookDelivery: {
      updateMany: async () => {
        throw Object.assign(new Error('The table `public.settlement_webhook_deliveries` does not exist in the current database.'), { code: 'P2021' });
      },
    },
  } as any);

  await assert.doesNotReject(async () => service.processPendingRetries(10));
  assert.equal(await service.processPendingRetries(10), 0);
});
