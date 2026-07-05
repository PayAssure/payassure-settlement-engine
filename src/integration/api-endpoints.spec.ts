import assert = require('node:assert/strict');
import test = require('node:test');
import * as bcrypt from 'bcrypt';
import { AuthController } from '../auth/auth.controller';
import { AuthService } from '../auth/auth.service';
import { OnbordingsController } from '../onbordings/onbordings.controller';
import { OnbordingsService } from '../onbordings/onbordings.service';
import { SettlementController } from '../settlement/settlement.controller';
import { SettlementService } from '../settlement/settlement.service';

class AuthRepositoryStub {
  private users: Array<any> = [];
  private onboardings: Array<any> = [];

  private hashCredential(secret: string) {
    return require('crypto').createHash('sha256').update(secret).digest('hex');
  }

  async createUser(data: any) {
    const user = { id: `user-${this.users.length + 1}`, ...data, role: data.role ?? 'USER', isActive: true, refreshTokenVersion: 0, createdAt: new Date(), updatedAt: new Date() };
    this.users.push(user);
    return user;
  }

  async findByIdentifier(identifier: string) {
    return this.users.find((user) => user.email === identifier || user.username === identifier) ?? null;
  }

  async findByEmail(email: string) {
    return this.users.find((user) => user.email === email) ?? null;
  }

  async findByUsername(username: string) {
    return this.users.find((user) => user.username === username) ?? null;
  }

  async findByEmailOrUsername(username: string, email: string) {
    return this.users.find((user) => user.email === email || user.username === username) ?? null;
  }

  async findById(id: string) {
    return this.users.find((user) => user.id === id) ?? null;
  }

  async findOnboardedByEmail(email: string) {
    return this.onboardings.find((participant) => participant.email === email) ?? null;
  }

  async activateBusinessIfComplete(email: string) {
    const onboarding = this.onboardings.find((participant) => participant.email === email);
    if (onboarding) {
      onboarding.status = 'ACTIVE';
    }
  }

  async incrementRefreshTokenVersion(userId: string) {
    const user = this.users.find((entry) => entry.id === userId);
    if (user) {
      user.refreshTokenVersion += 1;
    }
    return user;
  }

  async deleteUser(userId: string) {
    this.users = this.users.filter((user) => user.id !== userId);
  }

  async getAllUsers() {
    return { data: this.users, total: this.users.length, skip: 0, take: 10, hasMore: false };
  }

  seedOnboarding(onboarding: any) {
    this.onboardings.push(onboarding);
  }
}

class OnboardingRepositoryStub {
  private participants: Array<any> = [];
  private integrations: Array<any> = [];
  private nextParticipantId = 1;
  private nextIntegrationId = 1;

  private hashCredential(secret: string) {
    return require('crypto').createHash('sha256').update(secret).digest('hex');
  }

  async findUserByEmail(email: string) {
    return this.participants.find((participant) => participant.email === email) ?? null;
  }

  async findParticipantByEmail(email: string) {
    return this.participants.find((participant) => participant.email === email) ?? null;
  }

  async createParticipantWithoutIntegration(data: any) {
    const participant = {
      id: `participant-${this.nextParticipantId++}`,
      ...data,
      status: 'DRAFT',
      integrations: [],
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    this.participants.push(participant);
    return participant;
  }

  async findAllParticipants() {
    return this.participants;
  }

  async findParticipantById(id: string) {
    return this.participants.find((participant) => participant.id === id) ?? null;
  }

  async updateParticipant(id: string, data: any) {
    const participant = this.participants.find((entry) => entry.id === id);
    if (!participant) {
      throw new Error('Participant not found');
    }
    Object.assign(participant, data);
    return participant;
  }

  async activateParticipant(id: string) {
    const participant = this.participants.find((entry) => entry.id === id);
    if (!participant) {
      throw new Error('Participant not found');
    }
    participant.status = 'ACTIVE';
    return participant;
  }

  async updateWebhook(id: string, webhookUrl: string) {
    const participant = this.participants.find((entry) => entry.id === id);
    if (!participant) {
      throw new Error('Participant not found');
    }
    participant.webhookUrl = webhookUrl;
    return participant;
  }

  async updatePayment(id: string, payment: any) {
    const participant = this.participants.find((entry) => entry.id === id);
    if (!participant) {
      throw new Error('Participant not found');
    }
    participant.payment = payment;
    return participant;
  }

  async activatePayment(id: string, secret: string) {
    const participant = this.participants.find((entry) => entry.id === id);
    if (!participant) {
      throw new Error('Participant not found');
    }
    participant.payment = {
      ...(participant.payment ?? {}),
      status: 'VERIFIED',
      isVerified: true,
      verificationMethod: 'PAYMENT_ACTIVATION_SECRET',
      verifiedAt: new Date().toISOString(),
    };
    if (!secret) {
      throw new Error('secret required');
    }
    return participant;
  }

  async deleteParticipant(id: string) {
    this.participants = this.participants.filter((participant) => participant.id !== id);
  }

  async createIntegrationForParticipant(id: string, data: any) {
    const integration = {
      id: `integration-${this.nextIntegrationId++}`,
      participantId: id,
      merchantId: `pay_${this.nextIntegrationId}`,
      apiKey: 'pk_live_test123',
      apiSecret: 'sk_live_test123',
      apiKeyHash: this.hashCredential('pk_live_test123'),
      apiSecretHash: this.hashCredential('sk_live_test123'),
      environment: data.environment ?? 'production',
      isActive: true,
      webhookUrl: data.webhookUrl,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    this.integrations.push(integration);
    const participant = this.participants.find((entry) => entry.id === id);
    if (participant) {
      participant.integrations = [integration];
    }
    return integration;
  }

  async regenerateIntegrationCredentials(integrationId: string) {
    const integration = this.integrations.find((entry) => entry.id === integrationId);
    if (!integration) {
      throw new Error('Integration not found');
    }
    integration.apiKey = 'pk_live_regenerated';
    integration.apiSecret = 'sk_live_regenerated';
    return integration;
  }
}

class SettlementRepositoryStub {
  private sessions: Array<any> = [];
  private settlements: Array<any> = [];
  private transactions: Array<any> = [];

  async createSettlementSession(businessId: string, integrationId: string, token: string, expiresAt: Date) {
    const session = { id: 'session-1', businessId, integrationId, token, expiresAt, isUsed: false, usedAt: null };
    this.sessions.push(session);
    return session;
  }

  async findSettlementSessionByToken(token: string) {
    return this.sessions.find((session) => session.token === token) ?? null;
  }

  async findIntegrationById(id: string) {
    return { id, merchantId: 'pay_merchant_1', participantId: 'participant-1', participant: { id: 'participant-1', participantType: 'RETAILER', status: 'ACTIVE', businessName: 'Test Merchant' } };
  }

  async findIntegrationByMerchantId(merchantId: string) {
    return {
      id: 'supplier-integration-1',
      merchantId,
      participantId: 'supplier-1',
      participant: { id: 'supplier-1', participantType: 'SUPPLIER', status: 'ACTIVE', businessName: 'Supplier One', payment: { status: 'VERIFIED', isVerified: true } },
    };
  }

  async markSessionAsUsed(sessionId: string) {
    const session = this.sessions.find((entry) => entry.id === sessionId);
    if (session) {
      session.isUsed = true;
      session.usedAt = new Date();
    }
    return session;
  }

  async createSettlement(businessId: string, integrationId: string, payAssureReference: string, internalMerchantTransactionReference: string, data: any) {
    const settlement = {
      id: 'settlement-1',
      businessId,
      integrationId,
      amount: data.totalAmount,
      currency: data.currency,
      settlementMethod: data.settlementMethod,
      reference: payAssureReference,
      merchantTransactionReference: internalMerchantTransactionReference,
      description: data.description,
      metadata: data.metadata,
      paymentPayload: data,
      status: 'INITIATED',
      createdAt: new Date(),
      processedAt: null,
      transactions: [],
    };
    this.settlements.push(settlement);
    return settlement;
  }

  async createSupplierSettlement(businessId: string, integrationId: string, data: any) {
    const settlement = {
      id: 'supplier-settlement-1',
      businessId,
      integrationId,
      amount: data.amount ?? data.totalAmount,
      currency: data.currency,
      settlementMethod: data.settlementMethod,
      reference: data.reference,
      parentSettlementId: data.metadata?.parentSettlementId,
      status: 'INITIATED',
      createdAt: new Date(),
      transactions: [],
    };
    this.settlements.push(settlement);
    return settlement;
  }

  async createMultipleTransactions(settlementId: string, items: Array<any>) {
    const created = items.map((item, index) => ({ id: `txn-${index + 1}`, settlementId, ...item }));
    this.transactions.push(...created);
    return created;
  }

  async findSettlementByBusinessAndPayloadReference() {
    return null;
  }

  async findSettlementById(id: string) {
    return this.settlements.find((settlement) => settlement.id === id) ?? null;
  }

  async findTransactionById(id: string) {
    return this.transactions.find((transaction) => transaction.id === id) ?? null;
  }

  async updateSettlementReconciliation(settlementId: string, bankReference: string, bankTransactionId: string) {
    const settlement = this.settlements.find((entry) => entry.id === settlementId);
    if (settlement) {
      settlement.reconciliationStatus = 'VERIFIED';
      settlement.bankReference = bankReference;
      settlement.bankTransactionId = bankTransactionId;
      settlement.status = 'COMPLETED';
    }
    return settlement;
  }
}

test('covers auth, onboarding, and settlement API flows end to end', async () => {
  console.log('step 1: auth register-before-onboarding');
  const authRepository = new AuthRepositoryStub();
  const authService = new AuthService(authRepository as any, { sign: () => 'jwt-token', verify: () => ({ sub: 'user-1', version: 0 }) } as any);
  const authController = new AuthController(authService);
  const registerResult = await authController.registerBeforeOnboarding({ username: 'merchant', email: 'merchant@example.com', password: 'Secret123!' } as any);
  assert.equal(registerResult.profileComplete, false);
  console.log('step 1 passed: auth register-before-onboarding');

  console.log('step 2: auth login');
  const loginResult = await authController.login({ identifier: 'merchant@example.com', password: 'Secret123!' } as any);
  assert.ok(loginResult.accessToken);
  console.log('step 2 passed: auth login');

  console.log('step 3: auth refresh');
  const refreshResult = await authController.refresh({ refreshToken: loginResult.refreshToken } as any);
  assert.ok(refreshResult.accessToken);
  console.log('step 3 passed: auth refresh');

  console.log('step 4: onboarding create and generate keys');
  const onboardingRepository = new OnboardingRepositoryStub();
  const onboardingService = new OnbordingsService(onboardingRepository as any);
  const onboardingController = new OnbordingsController(onboardingService);
  const onboardingResult = await onboardingController.create({
    participantType: 'RETAILER',
    businessName: 'Test Merchant',
    contactName: 'Jane Doe',
    email: 'merchant@example.com',
    phoneNumber: '254700000000',
    settlementMethod: 'BANK',
    settlementAccount: '1234567890',
  } as any);
  assert.ok(onboardingResult.id);
  const keysResult = await onboardingController.generateApiKeys({ user: { email: 'merchant@example.com' } } as any);
  assert.ok(keysResult.integration?.apiKey);
  console.log('step 4 passed: onboarding create and generate keys');

  console.log('step 5: onboarding payment activation');
  const paymentResult = await onboardingController.updatePayment(onboardingResult.id, { payment: { type: 'MPESA', accountName: 'Jane Doe', payerPhoneNumber: '254700000000', provider: 'Safaricom' } } as any);
  assert.equal(paymentResult.payment?.status, 'PENDING_VERIFICATION');
  const activatedPayment = await onboardingController.activatePayment(onboardingResult.id, { paymentActivationSecret: paymentResult.payment?.paymentActivationSecret } as any);
  assert.equal(activatedPayment.payment?.status, 'VERIFIED');
  const activatedParticipant = await onboardingController.activate(onboardingResult.id);
  assert.equal(activatedParticipant.status, 'ACTIVE');
  console.log('step 5 passed: onboarding payment activation');

  console.log('step 6: settlement authenticate');
  const settlementRepository = new SettlementRepositoryStub();
  const settlementService = new SettlementService(settlementRepository as any);
  (settlementService as any).prisma = {
    integration: {
      findFirst: async () => ({
        id: 'integration-1',
        merchantId: 'pay_merchant_1',
        apiKeyHash: require('crypto').createHash('sha256').update('pk_live_test123').digest('hex'),
        apiSecretHash: require('crypto').createHash('sha256').update('sk_live_test123').digest('hex'),
        participant: { id: 'participant-1', email: 'merchant@example.com', status: 'ACTIVE', participantType: 'RETAILER', businessName: 'Test Merchant' },
      }),
    },
    onboardingParticipant: {
      findUnique: async () => ({ id: 'participant-1', businessName: 'Test Merchant' }),
    },
  };
  const settlementController = new SettlementController(settlementService);
  const authenticateResult = await settlementController.authenticate({ apiKey: 'pk_live_test123', apiSecret: 'sk_live_test123' } as any, { user: { email: 'merchant@example.com' } } as any);
  assert.ok(authenticateResult.token);
  console.log('step 6 passed: settlement authenticate');

  console.log('step 7: settlement initiate, track, get transaction, reconcile');
  const settlementResult = await settlementController.initiateSettlement({
    merchantTransactionReference: 'TXN-API-001',
    totalAmount: 7200,
    currency: 'KES',
    settlementMethod: 'BANK_TRANSFER',
    paymentMethod: { type: 'MPESA', payerPhoneNumber: '254700000000' },
    transactionDate: '2026-07-03T17:30:15+03:00',
    suppliers: [{ supplierMerchantId: 'SUP-1001', items: [{ itemId: 'ITEM-001', supplierAmount: 7200 }] }],
  } as any, authenticateResult.token);
  assert.ok(settlementResult.settlement?.settlementId);
  const trackResult = await settlementController.trackSettlement(settlementResult.settlement.settlementId);
  assert.ok(trackResult.settlement?.settlementId);
  const transactionResult = await settlementController.getTransaction('txn-1');
  assert.ok(transactionResult.transaction?.transactionId);
  const reconcileResult = await settlementController.reconcileSettlement({ settlementId: settlementResult.settlement.settlementId, bankReference: 'BANK-REF-1', bankTransactionId: 'BTX-1' } as any);
  assert.equal(reconcileResult.settlement?.status, 'COMPLETED');
  const healthResult = settlementController.getHealth();
  assert.equal(healthResult.status, 'ok');
  console.log('step 7 passed: settlement initiate, track, get transaction, reconcile');
});

test('covers rejected authentication and settlement failure scenarios', async () => {
  console.log('step 1: reject invalid login credentials');
  const authRepository = new AuthRepositoryStub();
  const authService = new AuthService(authRepository as any, { sign: () => 'jwt-token', verify: () => ({ sub: 'user-1', version: 0 }) } as any);
  const authController = new AuthController(authService);
  await assert.rejects(
    () => authController.login({ identifier: 'merchant@example.com', password: 'WrongSecret!' } as any),
    (error: any) => {
      const message = error?.response?.message ?? error?.message ?? '';
      return /invalid|unauthorized|credentials/i.test(String(message));
    },
  );
  console.log('step 1 passed: invalid login credentials are rejected');

  console.log('step 2: reject invalid settlement authentication credentials');
  const settlementRepository = new SettlementRepositoryStub();
  const settlementService = new SettlementService(settlementRepository as any);
  (settlementService as any).prisma = {
    integration: {
      findFirst: async () => ({
        id: 'integration-1',
        merchantId: 'pay_merchant_1',
        apiKeyHash: require('crypto').createHash('sha256').update('pk_live_test123').digest('hex'),
        apiSecretHash: require('crypto').createHash('sha256').update('sk_live_test123').digest('hex'),
        participant: { id: 'participant-1', email: 'merchant@example.com', status: 'ACTIVE', participantType: 'RETAILER', businessName: 'Test Merchant' },
      }),
    },
    onboardingParticipant: {
      findUnique: async () => ({ id: 'participant-1', businessName: 'Test Merchant' }),
    },
  };
  const settlementController = new SettlementController(settlementService);
  await assert.rejects(
    () => settlementController.authenticate({ apiKey: 'bad-key', apiSecret: 'bad-secret' } as any, { user: { email: 'merchant@example.com' } } as any),
    (error: any) => {
      const message = error?.response?.message ?? error?.message ?? '';
      return /invalid|unauthorized|credentials/i.test(String(message));
    },
  );
  console.log('step 2 passed: invalid settlement credentials are rejected');

  console.log('step 3: reject an expired settlement session token');
  const expiredSession = await settlementRepository.createSettlementSession('participant-1', 'integration-1', 'expired-session', new Date(Date.now() - 60000));
  await assert.rejects(
    () => settlementController.initiateSettlement({
      merchantTransactionReference: 'TXN-REJECT-001',
      totalAmount: 7200,
      currency: 'KES',
      settlementMethod: 'BANK_TRANSFER',
      paymentMethod: { type: 'MPESA', payerPhoneNumber: '254700000000' },
      transactionDate: '2026-07-03T17:30:15+03:00',
      suppliers: [{ supplierMerchantId: 'SUP-1001', items: [{ itemId: 'ITEM-001', supplierAmount: 7200 }] }],
    } as any, expiredSession.token),
    (error: any) => {
      const message = error?.response?.message ?? error?.message ?? '';
      return /expired|token|invalid/i.test(String(message));
    },
  );
  console.log('step 3 passed: expired settlement sessions are rejected');

  console.log('step 4: reject invalid settlement payload data');
  await assert.rejects(
    () => settlementController.initiateSettlement({
      merchantTransactionReference: 'TXN-REJECT-002',
      totalAmount: 0,
      currency: 'KES',
      settlementMethod: 'BANK_TRANSFER',
      paymentMethod: { type: 'MPESA', payerPhoneNumber: '254700000000' },
      transactionDate: '2026-07-03T17:30:15+03:00',
      suppliers: [{ supplierMerchantId: 'SUP-1001', items: [{ itemId: 'ITEM-001', supplierAmount: 7200 }] }],
    } as any, 'valid-session-token'),
    (error: any) => {
      const message = error?.response?.message ?? error?.message ?? '';
      return /validation|bad request|invalid/i.test(String(message));
    },
  );
  console.log('step 4 passed: invalid settlement payloads are rejected');
});

test('exposes a swagger-driven settlement scenario runner', async () => {
  const settlementRepository = new SettlementRepositoryStub();
  const settlementService = new SettlementService(settlementRepository as any);
  (settlementService as any).prisma = {
    integration: {
      findFirst: async () => ({
        id: 'integration-1',
        merchantId: 'pay_merchant_1',
        apiKeyHash: require('crypto').createHash('sha256').update('pk_live_test123').digest('hex'),
        apiSecretHash: require('crypto').createHash('sha256').update('sk_live_test123').digest('hex'),
        participant: { id: 'participant-1', email: 'merchant@example.com', status: 'ACTIVE', participantType: 'RETAILER', businessName: 'Test Merchant' },
      }),
    },
    onboardingParticipant: {
      findUnique: async () => ({ id: 'participant-1', businessName: 'Test Merchant' }),
    },
  };
  const settlementController = new SettlementController(settlementService);

  const result = await settlementController.runScenario({
    scenario: 'happy-path',
    credentialMode: 'fake',
    apiKey: 'pk_live_test123',
    apiSecret: 'sk_live_test123',
    merchantTransactionReference: 'TXN-SWAGGER-001',
  } as any);

  assert.equal(result.status, 'passed');
  assert.equal(result.scenario, 'happy-path');
  assert.match(result.message, /happy/i);
});
