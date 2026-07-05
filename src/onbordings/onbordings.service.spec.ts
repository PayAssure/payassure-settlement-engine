import assert = require('node:assert/strict');
import test = require('node:test');
import { OnbordingsService } from './onbordings.service';

test('updatePayment stores a pending verification lifecycle and activation secret hash', async () => {
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
    payerPhoneNumber: '254700000000',
    provider: 'Safaricom',
  } as any);

  assert.equal(response.payment?.status, 'PENDING_VERIFICATION');
  assert.equal(response.payment?.isVerified, false);
  assert.ok(response.payment?.paymentActivationSecretHash);
  assert.ok(response.payment?.paymentActivationSecretExpiresAt);
});

test('updatePayment rejects client-supplied verification flags and bank-only fields for MPESA requests', async () => {
  const service = new OnbordingsService({ updatePayment: async () => null } as any);

  await assert.rejects(
    () => service.updatePayment('participant-1', {
      type: 'MPESA',
      accountName: 'Jane Doe',
      isVerified: true,
      payerPhoneNumber: '254700000000',
      provider: 'Safaricom',
      bankCode: '07',
      accountNumber: '1234567890',
    } as any),
    /isVerified is managed by the backend/i,
  );
});

test('updatePayment rejects payerPhoneNumber when the payment type is BANK', async () => {
  const service = new OnbordingsService({ updatePayment: async () => null } as any);

  await assert.rejects(
    () => service.updatePayment('participant-1', {
      type: 'BANK',
      accountName: 'Jane Doe',
      payerPhoneNumber: '254700000000',
      provider: 'Safaricom',
      bankCode: '07',
      accountNumber: '1234567890',
    } as any),
    /BANK payouts do not accept payerPhoneNumber/i,
  );
});

test('activatePayment marks a pending payment as verified when the secret is valid', async () => {
  const repository = {
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
  const response = await service.activatePayment('participant-1', { paymentActivationSecret: 'paysec_valid' } as any);

  assert.equal(response.payment?.status, 'VERIFIED');
  assert.equal(response.payment?.isVerified, true);
});
