import assert = require('node:assert/strict');
import test = require('node:test');
import { createHash } from 'crypto';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { CreateOnboardingDto } from './dto/create-onboarding.dto';
import { OnbordingsService } from './onbordings.service';

test('CreateOnboardingDto strips nulls from optional fields and rejects required nulls', async () => {
  const dto = plainToInstance(CreateOnboardingDto, {
    participantType: 'RETAILER',
    businessName: 'Test Merchant',
    registrationNumber: null,
    email: null,
    payment: {
      type: 'MPESA',
      accountName: 'Jane Doe',
      phoneNumber: null,
      provider: 'Safaricom',
    },
  });

  const errors = await validate(dto);

  assert.equal(errors.length, 1);
  assert.equal(dto.registrationNumber, undefined);
  assert.equal(dto.email, undefined);
  assert.equal(dto.payment?.phoneNumber, undefined);
  assert.equal(errors[0].property, 'payment');
});

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

test('updateParticipantForAuthenticatedUser updates the participant found from the token email', async () => {
  let updatedParticipantId: string | undefined;
  const participant = {
    id: 'participant-user-1',
    participantType: 'RETAILER',
    businessName: 'Test Merchant',
    email: 'jane@example.com',
    status: 'DRAFT',
    integrations: [],
    createdAt: new Date(),
    updatedAt: new Date(),
  };
  const service = new OnbordingsService({
    findParticipantByEmail: async (email: string) => email === 'jane@example.com' ? participant : null,
    updateParticipant: async (id: string, data: any) => {
      updatedParticipantId = id;
      return { ...participant, ...data };
    },
  } as any);

  const response = await service.updateParticipantForAuthenticatedUser(
    { sub: 'user-1', email: 'jane@example.com' } as any,
    { businessName: 'Updated Merchant' } as any,
  );

  assert.equal(updatedParticipantId, 'participant-user-1');
  assert.equal(response.businessName, 'Updated Merchant');
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
  let lookupEmail: string | undefined;
  let activatedParticipantId: string | undefined;
  let activatedSecret: string | undefined;
  const repository = {
    findParticipantByEmail: async (email: string) => {
      lookupEmail = email;
      return ({
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
      });
    },
    activatePayment: async (id: string, secret: string) => {
      activatedParticipantId = id;
      activatedSecret = secret;
      return {
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
      };
    },
  };

  const service = new OnbordingsService(repository as any);
  const response = await service.activatePayment({ sub: 'user-1', email: 'jane@example.com' } as any, { paymentActivationSecret: 'paysec_valid' } as any);

  assert.equal(lookupEmail, 'jane@example.com');
  assert.equal(activatedParticipantId, 'participant-1');
  assert.equal(activatedSecret, 'paysec_valid');
  assert.equal(response.payment?.status, 'VERIFIED');
  assert.equal(response.payment?.isVerified, true);
});

test('resendPaymentActivationSecret rotates the pending secret and emails it to the authenticated user', async () => {
  let updatedPayment: Record<string, unknown> | undefined;
  let sentEmail: Record<string, unknown> | undefined;
  const service = new OnbordingsService({
    findParticipantByEmail: async (email: string) => ({
      id: 'participant-1',
      email,
      businessName: 'Test Merchant',
      contactName: 'Jane Doe',
      payment: {
        type: 'MPESA',
        accountName: 'Jane Doe',
        status: 'PENDING_VERIFICATION',
        paymentActivationSecretHash: 'old-hash',
        paymentActivationSecretExpiresAt: '2026-01-01T00:00:00.000Z',
        verificationAttempts: 3,
      },
    }),
    updatePayment: async (_id: string, payment: Record<string, unknown>) => {
      updatedPayment = payment;
      return {};
    },
  } as any, {
    sendPaymentSecretEmail: async (data: Record<string, unknown>, context: string) => {
      sentEmail = { ...data, context };
    },
  } as any);

  const response = await service.resendPaymentActivationSecret({ email: 'jane@example.com' });
  const emailedSecret = sentEmail?.paymentSecret as string;
  const expiryTime = new Date(updatedPayment?.paymentActivationSecretExpiresAt as string).getTime();

  assert.equal(response.message, 'A new payment activation secret has been sent to your email address.');
  assert.equal(sentEmail?.email, 'jane@example.com');
  assert.equal(sentEmail?.name, 'Jane Doe');
  assert.equal(sentEmail?.context, 'resend');
  assert.match(emailedSecret, /^paysec_[a-f0-9]{32}$/);
  assert.equal(updatedPayment?.paymentActivationSecretHash, createHash('sha256').update(emailedSecret).digest('hex'));
  assert.equal(updatedPayment?.paymentActivationSecretExpiresAt, sentEmail?.expiresAt);
  assert.ok(expiryTime > Date.now());
  assert.equal(updatedPayment?.verificationAttempts, 0);
  assert.equal('paymentActivationSecret' in (updatedPayment ?? {}), false);
  assert.equal(JSON.stringify(response).includes(emailedSecret), false);
});

test('resendPaymentActivationSecret rejects payment destinations that are not pending', async () => {
  let updated = false;
  const service = new OnbordingsService({
    findParticipantByEmail: async () => ({
      id: 'participant-1',
      payment: { status: 'VERIFIED' },
    }),
    updatePayment: async () => {
      updated = true;
    },
  } as any, { sendPaymentSecretEmail: async () => {} } as any);

  await assert.rejects(
    () => service.resendPaymentActivationSecret({ email: 'jane@example.com' }),
    /not pending verification/i,
  );
  assert.equal(updated, false);
});

test('resendPaymentActivationSecret reports email delivery failure', async () => {
  const service = new OnbordingsService({
    findParticipantByEmail: async (email: string) => ({
      id: 'participant-1',
      email,
      businessName: 'Test Merchant',
      payment: { status: 'PENDING_VERIFICATION' },
    }),
    updatePayment: async () => ({}),
  } as any, {
    sendPaymentSecretEmail: async () => {
      throw new Error('SMTP unavailable');
    },
  } as any);

  await assert.rejects(
    () => service.resendPaymentActivationSecret({ email: 'jane@example.com' }),
    /Unable to send payment activation secret email/i,
  );
});
