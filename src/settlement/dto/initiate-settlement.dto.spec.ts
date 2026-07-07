import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import * as bcrypt from 'bcrypt';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { InitiateSettlementDto } from './initiate-settlement.dto';
import { AuthService } from '../../auth/auth.service';
import { OnbordingsService } from '../../onbordings/onbordings.service';
import { SettlementService } from '../settlement.service';

class StubAuthRepository {
  async findByIdentifier() {
    return {
      id: 'user-1',
      username: 'merchant',
      email: 'merchant@example.com',
      role: 'USER',
      isActive: true,
      refreshTokenVersion: 0,
      passwordHash: bcrypt.hashSync('Secret123!', 10),
    };
  }
  async findByEmail() { return null; }
  async findByUsername() { return null; }
  async findByEmailOrUsername() { return null; }
  async findById() { return { id: 'user-1', username: 'merchant', email: 'merchant@example.com', role: 'USER', isActive: true, refreshTokenVersion: 0 }; }
  async findOnboardedByEmail() { return { id: 'participant-1', participantType: 'RETAILER', businessName: 'Test Merchant', contactName: 'Jane Doe', email: 'merchant@example.com', phoneNumber: '254700000000', settlementMethod: 'BANK', settlementAccount: '1234567890', payment: { status: 'VERIFIED', isVerified: true } }; }
  async activateBusinessIfComplete() { return undefined; }
  async incrementRefreshTokenVersion() { return { id: 'user-1', username: 'merchant', email: 'merchant@example.com', role: 'USER', isActive: true, refreshTokenVersion: 1 }; }
  async deleteUser() { return undefined; }
  async getAllUsers() { return { data: [], total: 0, skip: 0, take: 10, hasMore: false }; }
  async createUser(data: any) { return { id: 'user-1', ...data }; }
}

class StubOnboardingRepository {
  async findUserByEmail() { return { id: 'user-1', email: 'merchant@example.com' }; }
  async findParticipantByEmail() { return { id: 'participant-1', participantType: 'RETAILER', businessName: 'Test Merchant', contactName: 'Jane Doe', email: 'merchant@example.com', phoneNumber: '254700000000', settlementMethod: 'BANK', settlementAccount: '1234567890', payment: { status: 'VERIFIED', isVerified: true }, integrations: [{ id: 'integration-1', merchantId: 'pay_123', apiKey: 'pk_live_123', apiSecret: 'sk_live_123' }] }; }
  async createParticipantWithoutIntegration(data: any) { return { id: 'participant-1', ...data, integrations: [] }; }
  async findAllParticipants() { return []; }
  async findParticipantById() { return { id: 'participant-1', participantType: 'RETAILER', businessName: 'Test Merchant', contactName: 'Jane Doe', email: 'merchant@example.com', phoneNumber: '254700000000', settlementMethod: 'BANK', settlementAccount: '1234567890', payment: { status: 'VERIFIED', isVerified: true }, integrations: [] }; }
  async updateParticipant() { return { id: 'participant-1', participantType: 'RETAILER', businessName: 'Test Merchant', contactName: 'Jane Doe', email: 'merchant@example.com', phoneNumber: '254700000000', settlementMethod: 'BANK', settlementAccount: '1234567890', payment: { status: 'VERIFIED', isVerified: true }, integrations: [] }; }
  async activateParticipant() { return { id: 'participant-1', participantType: 'RETAILER', businessName: 'Test Merchant', contactName: 'Jane Doe', email: 'merchant@example.com', phoneNumber: '254700000000', settlementMethod: 'BANK', settlementAccount: '1234567890', payment: { status: 'VERIFIED', isVerified: true }, integrations: [{ id: 'integration-1', merchantId: 'pay_123', isActive: true }] }; }
  async updateWebhook() { return { id: 'participant-1' }; }
  async updatePayment() { return { id: 'participant-1', payment: { status: 'PENDING_VERIFICATION', isVerified: false } }; }
  async activatePayment() { return { id: 'participant-1', payment: { status: 'VERIFIED', isVerified: true } }; }
  async deleteParticipant() { return undefined; }
  async createIntegrationForParticipant() { return { id: 'integration-1', merchantId: 'pay_123', apiKey: 'pk_live_123', apiSecret: 'sk_live_123' }; }
  async regenerateIntegrationCredentials() { return { id: 'integration-1', merchantId: 'pay_123', apiKey: 'pk_live_123', apiSecret: 'sk_live_123' }; }
}

class StubSettlementRepository {
  async createSettlementSession() { return { id: 'session-1', businessId: 'participant-1', integrationId: 'integration-1', token: 'token-1', expiresAt: new Date(Date.now() + 3600000), lastUsedAt: null, status: 'ACTIVE' }; }
  async findSettlementSessionByToken() { return { id: 'session-1', businessId: 'participant-1', integrationId: 'integration-1', token: 'token-1', expiresAt: new Date(Date.now() + 3600000), lastUsedAt: null, status: 'ACTIVE' }; }
  async findIntegrationById() { return { id: 'integration-1', merchantId: 'pay_123', participantId: 'participant-1', participant: { id: 'participant-1', participantType: 'RETAILER', status: 'ACTIVE', businessName: 'Test Merchant' } }; }
  async findIntegrationByMerchantId() { return { id: 'integration-1', merchantId: 'pay_123', participantId: 'participant-1', participant: { id: 'participant-1', participantType: 'SUPPLIER', status: 'ACTIVE', businessName: 'Supplier One', payment: { status: 'VERIFIED', isVerified: true } } }; }
  async updateSettlementSession() { return { id: 'session-1' }; }
  async deleteSettlementSessions() { return { count: 1 }; }
  async createSettlement() { return { id: 'settlement-1', businessId: 'participant-1', integrationId: 'integration-1', amount: 16500, currency: 'KES', settlementMethod: 'BANK_TRANSFER', status: 'INITIATED', reference: 'payset-1', createdAt: new Date() }; }
  async createSupplierSettlement() { return { id: 'supplier-settlement-1', businessId: 'participant-1', integrationId: 'integration-1', amount: 7200, currency: 'KES', settlementMethod: 'BANK_TRANSFER', status: 'INITIATED', reference: 'payset-2', parentSettlementId: 'settlement-1', createdAt: new Date() }; }
  async markSessionAsUsed() { return { id: 'session-1', lastUsedAt: new Date(), status: 'ACTIVE' }; }
  async touchSession() { return { id: 'session-1', lastUsedAt: new Date(), status: 'ACTIVE' }; }
  async createMultipleTransactions() { return [{ id: 'txn-1', settlementId: 'settlement-1', itemId: 'ITEM-001', supplierMerchantId: 'SUP-1001' }]; }
  async findSettlementById() { return { id: 'settlement-1', businessId: 'participant-1', integrationId: 'integration-1', amount: 16500, currency: 'KES', settlementMethod: 'BANK_TRANSFER', status: 'INITIATED', reference: 'payset-1', createdAt: new Date(), transactions: [] }; }
  async findSettlementByBusinessAndPayloadReference() { return null; }
  async findSettlementsByBusinessId() { return []; }
  async updateSettlementStatus() { return { id: 'settlement-1' }; }
}

test('rejects settlement payload without supplier allocations', async () => {
  console.log('step 1: validate an empty supplier allocation payload');
  const dto = plainToInstance(InitiateSettlementDto, {
    merchantTransactionReference: 'TXN-001',
    totalAmount: 5000,
    currency: 'KES',
    settlementMethod: 'BANK_TRANSFER',
    paymentMethod: {
      type: 'MPESA',
      payerPhoneNumber: '254712345678',
    },
    transactionDate: '2026-07-03T17:30:15+03:00',
    suppliers: [],
  });

  const errors = await validate(dto);
  assert.ok(errors.length > 0, 'expected DTO validation to fail when suppliers are missing');
  console.log('step 1 passed: empty supplier allocations are rejected');
});

test('accepts supplier-based settlement payload with optional metadata', async () => {
  console.log('step 1: validate a fully populated supplier-based payload');
  const dto = plainToInstance(InitiateSettlementDto, {
    merchantTransactionReference: 'TXN-0001',
    totalAmount: 16500,
    currency: 'KES',
    settlementMethod: 'BANK_TRANSFER',
    paymentMethod: {
      type: 'MPESA',
      payerPhoneNumber: '254712345678',
    },
    transactionDate: '2026-07-03T17:30:15+03:00',
    metadata: {
      branchId: 'BR-01',
      terminalId: 'POS-03',
    },
    suppliers: [
      {
        supplierMerchantId: 'SUP-1001',
        items: [
          {
            itemReference: 'ITEM-001',
            supplierAmount: 3200,
          },
          {
            itemReference: 'ITEM-002',
            supplierAmount: 4000,
          },
        ],
      },
    ],
  });

  const errors = await validate(dto);
  assert.equal(errors.length, 0, 'expected DTO validation to pass for valid supplier-based settlement payload');
  console.log('step 1 passed: valid supplier-based payload is accepted');
});

test('accepts a simplified supplier-only settlement payload without item details', async () => {
  console.log('step 1: validate a supplier summary payload that omits detailed item arrays');
  const dto = plainToInstance(InitiateSettlementDto, {
    merchantTransactionReference: 'TXN-0009',
    totalAmount: 16500,
    currency: 'KES',
    settlementMethod: 'BANK_TRANSFER',
    paymentMethod: {
      type: 'MPESA',
      payerPhoneNumber: '254712345678',
    },
    transactionDate: '2026-07-03T17:30:15+03:00',
    suppliers: [
      {
        supplierMerchantId: 'SUP-1001',
        supplierTotalAmount: 7200,
        retailerTotalAmount: 900,
        platformFee: 64.8,
      },
    ],
  });

  const errors = await validate(dto);
  assert.equal(errors.length, 0, 'expected DTO validation to pass for a simplified supplier summary payload');
  console.log('step 1 passed: simplified supplier summary payload is accepted');
});

test('rejects unsupported currency and negative supplier allocations', async () => {
  console.log('step 1: validate a payload with unsupported currency and negative allocations');
  const dto = plainToInstance(InitiateSettlementDto, {
    merchantTransactionReference: 'TXN-0005',
    totalAmount: 5000,
    currency: 'BTC',
    settlementMethod: 'BANK_TRANSFER',
    paymentMethod: {
      type: 'MPESA',
      payerPhoneNumber: '254712345678',
    },
    transactionDate: '2026-07-03T17:30:15+03:00',
    suppliers: [
      {
        supplierMerchantId: 'SUP-1001',
        items: [{ itemReference: 'ITEM-001', supplierAmount: -500 }],
      },
    ],
  });

  const errors = await validate(dto);
  assert.ok(errors.length > 0, 'expected DTO validation to fail for unsupported currency and negative allocations');
  console.log('step 1 passed: unsupported currency and negative allocations are rejected');
});

test('rejects unsupported payment methods during settlement initiation', async () => {
  console.log('step 1: exercise the service-level rejection path for unsupported payment methods');
  const settlementService = new SettlementService(new StubSettlementRepository() as any);

  await assert.rejects(
    () => settlementService.initiateSettlement('token-1', {
      merchantTransactionReference: 'TXN-0006',
      totalAmount: 7200,
      currency: 'KES',
      settlementMethod: 'BANK_TRANSFER',
      paymentMethod: { type: 'APPLEPAY', payerPhoneNumber: '254712345678' },
      transactionDate: '2026-07-03T17:30:15+03:00',
      suppliers: [
        {
          supplierMerchantId: 'SUP-1001',
          items: [{ itemId: 'ITEM-001', supplierAmount: 7200 }],
        },
      ],
    } as any),
    /Validation failed|Unsupported payment method/,
  );
  console.log('step 1 passed: unsupported payment method is rejected');
});

test('returns the existing settlement when the merchant reference is duplicated', async () => {
  console.log('step 1: verify duplicate merchant references are treated as idempotent');
  const repository = new StubSettlementRepository() as any;
  repository.findSettlementByBusinessAndPayloadReference = async () => ({
    id: 'existing-settlement-1',
    status: 'INITIATED',
    amount: 7200,
    currency: 'KES',
    reference: 'payset-existing',
    createdAt: new Date(),
    transactions: [],
  });

  const settlementService = new SettlementService(repository);
  const result = await settlementService.initiateSettlement('token-1', {
    merchantTransactionReference: 'TXN-0007',
    totalAmount: 7200,
    currency: 'KES',
    settlementMethod: 'BANK_TRANSFER',
    paymentMethod: { type: 'MPESA', payerPhoneNumber: '254712345678' },
    transactionDate: '2026-07-03T17:30:15+03:00',
    suppliers: [
      {
        supplierMerchantId: 'SUP-1001',
        items: [{ itemId: 'ITEM-001', supplierAmount: 7200 }],
      },
    ],
  } as any);

  assert.equal(result.settlement?.settlementId, 'existing-settlement-1');
  assert.ok(typeof result.message === 'string' && /already processed/i.test(result.message));
  console.log('step 1 passed: duplicate merchant references are handled safely');
});

test('rejects a reused settlement session token', async () => {
  console.log('step 1: validate that a used one-time token is rejected');
  const repository = new StubSettlementRepository() as any;
  repository.findSettlementSessionByToken = async () => ({
    id: 'session-1',
    businessId: 'participant-1',
    integrationId: 'integration-1',
    token: 'token-1',
    expiresAt: new Date(Date.now() + 3600000),
    status: 'REVOKED',
    lastUsedAt: new Date(),
  });

  const settlementService = new SettlementService(repository);
  await assert.rejects(
    () => settlementService.initiateSettlement('token-1', {
      merchantTransactionReference: 'TXN-0008',
      totalAmount: 7200,
      currency: 'KES',
      settlementMethod: 'BANK_TRANSFER',
      paymentMethod: { type: 'MPESA', payerPhoneNumber: '254712345678' },
      transactionDate: '2026-07-03T17:30:15+03:00',
      suppliers: [
        {
          supplierMerchantId: 'SUP-1001',
          items: [{ itemId: 'ITEM-001', supplierAmount: 7200 }],
        },
      ],
    } as any),
    /SESSION_INACTIVE|INVALID_TOKEN|already been used/i,
  );
  console.log('step 1 passed: reused session tokens are rejected');
});

test('rejects a settlement when the supplier payout destination is not verified', async () => {
  console.log('step 1: exercise the service-level rejection path for unverified supplier payout');
  const settlementService = new SettlementService(new StubSettlementRepository() as any);
  (settlementService as any).prisma = {
    integration: {
      findFirst: async () => ({
        id: 'integration-1',
        participantId: 'participant-1',
        merchantId: 'pay_123',
        apiKeyHash: 'hash',
        apiSecretHash: 'hash',
        participant: { id: 'participant-1', participantType: 'RETAILER', status: 'ACTIVE', businessName: 'Test Merchant', email: 'merchant@example.com', payment: { status: 'VERIFIED', isVerified: true } },
      }),
    },
    onboardingParticipant: {
      findUnique: async () => ({ id: 'participant-1', businessName: 'Test Merchant' }),
    },
  };

  await assert.rejects(
    () => settlementService.initiateSettlement('token-1', {
      merchantTransactionReference: 'TXN-0004',
      totalAmount: 7200,
      currency: 'KES',
      settlementMethod: 'BANK_TRANSFER',
      paymentMethod: { type: 'MPESA', payerPhoneNumber: '254712345678' },
      transactionDate: '2026-07-03T17:30:15+03:00',
      suppliers: [
        {
          supplierMerchantId: 'SUP-1001',
          items: [{ itemId: 'ITEM-001', supplierAmount: 7200 }],
        },
      ],
    } as any),
    /Validation failed|INITIATION_FAILED|Supplier payout destination/,
  );
  console.log('step 1 passed: unverified supplier payout is rejected');
});

test('shows the full merchant flow from authentication to settlement', async () => {
  console.log('step 1: authenticate merchant');
  const authService = new AuthService(new StubAuthRepository() as any, { sign: () => 'jwt-token', verify: () => ({ sub: 'user-1', version: 0 }) } as any);
  const authResult = await authService.login({ identifier: 'merchant@example.com', password: 'Secret123!' });
  assert.ok(authResult.accessToken);
  console.log('step 1 passed: auth token issued');

  console.log('step 2: create onboarding record and generate API keys');
  const onboardingService = new OnbordingsService(new StubOnboardingRepository() as any);
  const onboardingResult = await onboardingService.createParticipant({
    participantType: 'RETAILER',
    businessName: 'Test Merchant',
    contactName: 'Jane Doe',
    email: 'merchant@example.com',
    phoneNumber: '254700000000',
    settlementMethod: 'BANK',
    settlementAccount: '1234567890',
  } as any);
  assert.ok(onboardingResult.id);
  const keysResult = await onboardingService.generateApiKeys({ email: 'merchant@example.com' });
  assert.ok(keysResult.integration?.apiKey);
  console.log('step 2 passed: onboarding and API keys complete');

  console.log('step 3: register payment method and issue activation secret');
  const paymentResult = await onboardingService.updatePayment('participant-1', {
    type: 'MPESA',
    accountName: 'Jane Doe',
    payerPhoneNumber: '254700000000',
    provider: 'Safaricom',
  } as any);
  assert.equal(paymentResult.payment?.status, 'PENDING_VERIFICATION');
  assert.ok(paymentResult.payment?.paymentActivationSecret);
  console.log('step 3 passed: payment secret issued');

  console.log('step 4: activate payment verification');
  const activated = await onboardingService.activatePayment('participant-1', { paymentActivationSecret: paymentResult.payment?.paymentActivationSecret } as any);
  assert.equal(activated.payment?.status, 'VERIFIED');
  console.log('step 4 passed: payment verified');

  console.log('step 5: initiate settlement');
  const settlementService = new SettlementService(new StubSettlementRepository() as any);
  const settlementResult = await settlementService.initiateSettlement('token-1', {
    merchantTransactionReference: 'TXN-0003',
    totalAmount: 7200,
    currency: 'KES',
    settlementMethod: 'BANK_TRANSFER',
    paymentMethod: { type: 'MPESA', payerPhoneNumber: '254700000000' },
    transactionDate: '2026-07-03T17:30:15+03:00',
    suppliers: [
      {
        supplierMerchantId: 'SUP-1001',
        items: [{ itemId: 'ITEM-001', supplierAmount: 7200 }],
      },
    ],
  } as any);

  assert.ok(settlementResult.settlement?.settlementId);
  console.log('step 5 passed: settlement initiated');
});

test('rejects supplier total mismatch against item allocations', async () => {
  console.log('step 1: validate an allocation total mismatch payload');
  const dto = plainToInstance(InitiateSettlementDto, {
    merchantTransactionReference: 'TXN-0002',
    totalAmount: 7200,
    currency: 'KES',
    settlementMethod: 'BANK_TRANSFER',
    paymentMethod: {
      type: 'MPESA',
      payerPhoneNumber: '254712345678',
    },
    transactionDate: '2026-07-03T17:30:15+03:00',
    suppliers: [
      {
        supplierMerchantId: 'SUP-1001',
        supplierTotalAmount: 7300,
        items: [
          {
            itemId: 'ITEM-001',
            supplierAmount: 3200,
          },
          {
            itemId: 'ITEM-002',
            supplierAmount: 4000,
          },
        ],
      },
    ],
  });

  const errors = await validate(dto);
  assert.ok(errors.length > 0, 'expected DTO validation to fail for supplier total mismatch');
  console.log('step 1 passed: supplier total mismatch is rejected');
});
