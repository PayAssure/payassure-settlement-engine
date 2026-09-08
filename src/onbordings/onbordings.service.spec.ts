import assert = require('node:assert/strict');
import test = require('node:test');
import { OnbordingsService } from './onbordings.service';

test('updatePayment returns payment status without activation secret internals', async () => {
  const repository = {
    updatePayment: async (_id: string, payment: any) => ({
      id: 'participant-1',
      participantType: 'RETAILER',
      businessName: 'Test Merchant',
      businessType: null,
      contactName: 'Jane Doe',
      email: 'jane@example.com',
      status: 'DRAFT',
      payment,
      integrations: [],
      createdAt: new Date(),
      updatedAt: new Date(),
    }),
  };

  const service = new OnbordingsService(repository as any);

  const response = await service.updatePayment('participant-1', {
    type: 'MPESA',
    accountName: 'Jane Doe',
    phoneNumber: '254700000000',
    provider: 'Safaricom',
  } as any);

  assert.equal(response.payment?.status, 'PENDING_VERIFICATION');
  assert.equal(response.payment?.isVerified, false);
  assert.equal(response.payment?.paymentActivationSecretHash, undefined);
  assert.equal(response.payment?.paymentActivationSecretExpiresAt, undefined);
  assert.equal(response.payment?.verificationAttempts, undefined);
});

test('findAllParticipants returns a public response without secrets or integration credentials', async () => {
  const service = new OnbordingsService({
    findAllParticipants: async () => [{
      id: 'participant-1',
      participantType: 'RETAILER',
      businessName: 'Test Merchant',
      businessType: null,
      contactName: 'Jane Doe',
      email: 'jane@example.com',
      status: 'DRAFT',
      payment: {
        type: 'MPESA',
        accountName: 'Jane Doe',
        phoneNumber: '254748595539',
        status: 'PENDING_VERIFICATION',
        isVerified: false,
        provider: 'Safaricom',
        paymentActivationSecretHash: 'hash',
        paymentActivationSecretExpiresAt: '2026-07-24T08:53:13.919Z',
        verificationAttempts: 0,
      },
      integrations: [{
        merchantId: 'pay_4bec11e5a382fe7c',
        apiKey: 'pk_live_d093937d634dcb700b6d34ba6f29c55e',
        apiSecret: 'sk_live_85faf3a09cb5b38cb84c48b09a67da9f',
        environment: 'production',
        isActive: true,
      }],
      createdAt: new Date(),
      updatedAt: new Date(),
    }],
  } as any);

  const [response] = await service.findAllParticipants();

  assert.deepEqual(response.payment, {
    type: 'MPESA',
    accountName: 'Jane Doe',
    phoneNumber: '254748595539',
    status: 'PENDING_VERIFICATION',
    isVerified: false,
    provider: 'Safaricom',
  });
  assert.deepEqual(response.integration, {
    merchantId: 'pay_4bec11e5a382fe7c',
    apiKey: 'pk_live_d093937d634dcb700b6d34ba6f29c55e',
    apiSecret: 'sk_live_85faf3a09cb5b38cb84c48b09a67da9f',
    environment: 'production',
    isActive: true,
  });
  assert.equal('paymentActivationSecretHash' in (response.payment ?? {}), false);
  assert.equal('paymentActivationSecretExpiresAt' in (response.payment ?? {}), false);
  assert.equal('verificationAttempts' in (response.payment ?? {}), false);
});

test('findAllParticipants returns bank details for BANK payments', async () => {
  const service = new OnbordingsService({
    findAllParticipants: async () => [{
      id: 'participant-2',
      participantType: 'SUPPLIER',
      businessName: 'Test Supplier',
      status: 'DRAFT',
      payment: {
        type: 'BANK',
        accountName: 'Test Supplier',
        bankCode: '07',
        accountNumber: '1234567890',
        shortcode: '123456',
        provider: 'Test Bank',
        paymentActivationSecretHash: 'hash',
      },
      integrations: [],
      createdAt: new Date(),
      updatedAt: new Date(),
    }],
  } as any);

  const [response] = await service.findAllParticipants();

  assert.deepEqual(response.payment, {
    type: 'BANK',
    accountName: 'Test Supplier',
    status: undefined,
    isVerified: undefined,
    provider: 'Test Bank',
    bankCode: '07',
    accountNumber: '1234567890',
    shortcode: '123456',
  });
  assert.equal('phoneNumber' in (response.payment ?? {}), false);
  assert.equal('paymentActivationSecretHash' in (response.payment ?? {}), false);
});

test('updatePayment rejects client-supplied verification flags and bank-only fields for MPESA requests', async () => {
  const service = new OnbordingsService({ updatePayment: async () => null } as any);

  await assert.rejects(
    () => service.updatePayment('participant-1', {
      type: 'MPESA',
      accountName: 'Jane Doe',
      isVerified: true,
      phoneNumber: '254700000000',
      provider: 'Safaricom',
      bankCode: '07',
      accountNumber: '1234567890',
    } as any),
    /isVerified is managed by the backend/i,
  );
});

test('updatePayment rejects phoneNumber when the payment type is BANK', async () => {
  const service = new OnbordingsService({ updatePayment: async () => null } as any);

  await assert.rejects(
    () => service.updatePayment('participant-1', {
      type: 'BANK',
      accountName: 'Jane Doe',
      phoneNumber: '254700000000',
      provider: 'Safaricom',
      bankCode: '07',
      accountNumber: '1234567890',
    } as any),
    /BANK payouts do not accept phoneNumber/i,
  );
});

test('updatePayment accepts shortcode only for BANK payment destinations', async () => {
  const repository = {
    updatePayment: async (_id: string, payment: any) => ({
      id: 'participant-1',
      participantType: 'RETAILER',
      businessName: 'Test Merchant',
      businessType: null,
      contactName: 'Jane Doe',
      email: 'jane@example.com',
      status: 'DRAFT',
      payment,
      integrations: [],
      createdAt: new Date(),
      updatedAt: new Date(),
    }),
  };

  const service = new OnbordingsService(repository as any);
  const response = await service.updatePayment('participant-1', {
    type: 'BANK',
    accountName: 'Jane Doe',
    bankCode: '07',
    accountNumber: '1234567890',
    shortcode: '123456',
  } as any);

  assert.equal(response.payment?.shortcode, '123456');
});

test('activatePayment marks a pending payment as verified when the secret is valid', async () => {
  const repository = {
    findParticipantByEmail: async (email: string) => ({
      id: 'participant-1',
      email,
      participantType: 'RETAILER',
      businessName: 'Test Merchant',
      businessType: null,
      contactName: 'Jane Doe',
      status: 'DRAFT',
      payment: {
        type: 'MPESA',
        accountName: 'Jane Doe',
        status: 'PENDING_VERIFICATION',
        isVerified: false,
        paymentActivationSecretHash: 'hash',
        paymentActivationSecretExpiresAt: new Date(Date.now() + 10000).toISOString(),
      },
      integrations: [],
      createdAt: new Date(),
      updatedAt: new Date(),
    }),
    activatePayment: async (_id: string, _secret: string) => ({
      id: 'participant-1',
      participantType: 'RETAILER',
      businessName: 'Test Merchant',
      businessType: null,
      contactName: 'Jane Doe',
      email: 'jane@example.com',
      status: 'DRAFT',
      payment: {
        type: 'MPESA',
        accountName: 'Jane Doe',
        status: 'VERIFIED',
        isVerified: true,
        verificationMethod: 'PAYMENT_ACTIVATION_SECRET',
        verifiedAt: new Date().toISOString(),
      },
      integrations: [],
      createdAt: new Date(),
      updatedAt: new Date(),
    }),
  };

  const service = new OnbordingsService(repository as any);
  const response = await service.activatePayment({ email: 'jane@example.com' } as any, { paymentActivationSecret: 'paysec_valid' } as any);

  assert.equal(response.payment?.status, 'VERIFIED');
  assert.equal(response.payment?.isVerified, true);
});
