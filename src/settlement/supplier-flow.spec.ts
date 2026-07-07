import assert = require('node:assert/strict');
import test = require('node:test');
import { SettlementController } from './settlement.controller';
import { SettlementService } from './settlement.service';

class SupplierSettlementRepositoryStub {
  private sessions: Array<any> = [];
  private settlements: Array<any> = [];

  private hashCredential(secret: string) {
    return require('crypto').createHash('sha256').update(secret).digest('hex');
  }

  async createSettlementSession(businessId: string, integrationId: string, token: string, expiresAt: Date) {
    const session = { id: `session-${this.sessions.length + 1}`, businessId, integrationId, token, expiresAt, lastUsedAt: null, status: 'ACTIVE' };
    this.sessions.push(session);
    return session;
  }

  async findSettlementSessionByToken(token: string) {
    return this.sessions.find((session) => session.token === token) ?? null;
  }

  async touchSession(sessionId: string) {
    const session = this.sessions.find((entry) => entry.id === sessionId);
    if (session) {
      session.lastUsedAt = new Date();
    }
    return session;
  }

  async findIntegrationById(id: string) {
    return this.integrations.find((integration) => integration.id === id) ?? null;
  }

  async findIntegrationByMerchantId(merchantId: string) {
    return this.integrations.find((integration) => integration.merchantId === merchantId) ?? null;
  }

  private integrations: Array<any> = [
    {
      id: 'supplier-a-integration',
      participantId: 'supplier-a',
      merchantId: 'SUP-1001',
      apiKey: 'pk_supplier_a',
      apiSecret: 'sk_supplier_a',
      apiKeyHash: this.hashCredential('pk_supplier_a'),
      apiSecretHash: this.hashCredential('sk_supplier_a'),
      participant: { id: 'supplier-a', participantType: 'SUPPLIER', status: 'ACTIVE', businessName: 'Supplier A', email: 'supplier-a@example.com' },
      isActive: true,
    },
    {
      id: 'supplier-b-integration',
      participantId: 'supplier-b',
      merchantId: 'SUP-2001',
      apiKey: 'pk_supplier_b',
      apiSecret: 'sk_supplier_b',
      apiKeyHash: this.hashCredential('pk_supplier_b'),
      apiSecretHash: this.hashCredential('sk_supplier_b'),
      participant: { id: 'supplier-b', participantType: 'SUPPLIER', status: 'ACTIVE', businessName: 'Supplier B', email: 'supplier-b@example.com' },
      isActive: true,
    },
  ];

  async createSupplierSettlement(businessId: string, integrationId: string, data: any) {
    const settlement = {
      id: `settlement-${this.settlements.length + 1}`,
      businessId,
      integrationId,
      amount: data.amount,
      currency: data.currency,
      settlementMethod: data.settlementMethod,
      reference: data.reference,
      merchantTransactionReference: data.merchantTransactionReference,
      metadata: data.metadata,
      paymentPayload: data.paymentPayload,
      status: 'INITIATED',
      createdAt: new Date(),
    };
    this.settlements.push(settlement);
    return settlement;
  }

  async findSettlementById(id: string) {
    return this.settlements.find((settlement) => settlement.id === id) ?? null;
  }

  async findSettlementsBySupplierMerchantId(merchantId: string) {
    return this.settlements.filter((settlement) => settlement.metadata?.supplierMerchantId === merchantId);
  }
}

test('track settlement exposes retailer, supplier, and payassure views for the same settlement', async () => {
  const repository = new SupplierSettlementRepositoryStub();
  const settlement = await repository.createSupplierSettlement('retailer-1', 'retailer-integration', {
    amount: 15000,
    currency: 'KES',
    settlementMethod: 'BANK_TRANSFER',
    reference: 'PASS-20260707-00001',
    merchantTransactionReference: 'TXN-API-001',
    metadata: { supplierMerchantId: 'SUP-1001', retailerMerchantId: 'pay_4bec11e5a382fe7c', parentSettlementId: 'parent-001' },
    paymentPayload: {
      paymentMethod: { type: 'MPESA' },
      suppliers: [{ supplierMerchantId: 'SUP-1001', supplierTotalAmount: 15000, retailerTotalAmount: 1200, platformFee: 300, items: [{ itemReference: 'ITEM-001', supplierAmount: 8000 }, { itemReference: 'ITEM-002', supplierAmount: 7000 }] }],
    },
  });

  const service = new SettlementService(repository as any);
  (service as any).prisma = {
    onboardingParticipant: {
      findUnique: async () => ({ id: 'retailer-1', businessName: 'ABC Supermarket' }),
    },
  };

  const controller = new SettlementController(service);
  const retailerView = await controller.trackSettlement(settlement.id, 'retailer');
  assert.equal(retailerView.view, 'retailer');
  assert.equal(retailerView.settlement.amounts.total, 15000);
  assert.equal(retailerView.settlement.suppliers[0].amount, 15000);

  const supplierView = await controller.trackSettlement(settlement.id, 'supplier');
  assert.equal(supplierView.view, 'supplier');
  assert.equal(supplierView.settlement.items[0].itemReference, 'ITEM-001');
  assert.equal(supplierView.settlement.retailerMerchantId, 'pay_4bec11e5a382fe7c');

  const payAssureView = await controller.trackSettlement(settlement.id, 'payassure');
  assert.equal(payAssureView.view, 'payassure');
  assert.equal(payAssureView.settlement.reference, 'PASS-20260707-00001');
});

test('supplier authentication and settlement listing only return the authenticated supplier allocations', async () => {
  const repository = new SupplierSettlementRepositoryStub();
  const service = new SettlementService(repository as any);
  (service as any).prisma = {
    integration: {
      findFirst: async ({ where }: any) => {
        const integrations = [
          {
            id: 'supplier-a-integration',
            participantId: 'supplier-a',
            merchantId: 'SUP-1001',
            apiKey: 'pk_supplier_a',
            apiSecret: 'sk_supplier_a',
            apiKeyHash: require('crypto').createHash('sha256').update('pk_supplier_a').digest('hex'),
            apiSecretHash: require('crypto').createHash('sha256').update('sk_supplier_a').digest('hex'),
            participant: { id: 'supplier-a', participantType: 'SUPPLIER', status: 'ACTIVE', businessName: 'Supplier A', email: 'supplier-a@example.com' },
            isActive: true,
          },
          {
            id: 'supplier-b-integration',
            participantId: 'supplier-b',
            merchantId: 'SUP-2001',
            apiKey: 'pk_supplier_b',
            apiSecret: 'sk_supplier_b',
            apiKeyHash: require('crypto').createHash('sha256').update('pk_supplier_b').digest('hex'),
            apiSecretHash: require('crypto').createHash('sha256').update('sk_supplier_b').digest('hex'),
            participant: { id: 'supplier-b', participantType: 'SUPPLIER', status: 'ACTIVE', businessName: 'Supplier B', email: 'supplier-b@example.com' },
            isActive: true,
          },
        ];
        return integrations.find((integration) => integration.apiKey === where.apiKey) ?? null;
      },
    },
  };

  const controller = new SettlementController(service);

  const supplierA = await controller.authenticateSupplier({ apiKey: 'pk_supplier_a', apiSecret: 'sk_supplier_a' } as any, { email: 'supplier-a@example.com' } as any);
  const supplierB = await controller.authenticateSupplier({ apiKey: 'pk_supplier_b', apiSecret: 'sk_supplier_b' } as any, { email: 'supplier-b@example.com' } as any);

  await repository.createSupplierSettlement('retailer-1', 'retailer-integration', {
    amount: 15000,
    currency: 'KES',
    settlementMethod: 'BANK_TRANSFER',
    reference: 'PASS-20260707-00001',
    merchantTransactionReference: 'TXN-API-001',
    metadata: { supplierMerchantId: 'SUP-1001', retailerMerchantId: 'pay_4bec11e5a382fe7c', parentSettlementId: 'parent-001' },
    paymentPayload: {
      suppliers: [{ supplierMerchantId: 'SUP-1001', items: [{ itemReference: 'ITEM-001', supplierAmount: 15000 }] }],
    },
  });

  await repository.createSupplierSettlement('retailer-1', 'retailer-integration', {
    amount: 20000,
    currency: 'KES',
    settlementMethod: 'BANK_TRANSFER',
    reference: 'PASS-20260707-00002',
    merchantTransactionReference: 'TXN-API-002',
    metadata: { supplierMerchantId: 'SUP-2001', retailerMerchantId: 'pay_4bec11e5a382fe7c', parentSettlementId: 'parent-002' },
  });

  const supplierASettlements = await controller.getSupplierSettlements(supplierA.sessionToken);
  assert.equal(supplierASettlements.count, 1);
  assert.equal(supplierASettlements.data[0].amount, 15000);
  assert.equal(supplierASettlements.data[0].retailerMerchantId, 'pay_4bec11e5a382fe7c');
  assert.equal(supplierASettlements.data[0].itemReference, 'ITEM-001');

  const supplierBSettlements = await controller.getSupplierSettlements(supplierB.sessionToken);
  assert.equal(supplierBSettlements.count, 1);
  assert.equal(supplierBSettlements.data[0].amount, 20000);
  assert.equal(supplierBSettlements.data[0].itemReference, null);
});
