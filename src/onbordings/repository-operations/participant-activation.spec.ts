import assert = require('node:assert/strict');
import test = require('node:test');
import { createHash } from 'node:crypto';
import { ParticipantStatus } from '@prisma/client';
import { OnbordingsRepository } from '../onbordings.repository';

function createCompleteParticipant(payment: Record<string, unknown>, integrations: any[] = []) {
  return {
    id: 'participant-1',
    participantType: 'RETAILER',
    businessName: 'Test Merchant',
    contactName: 'Jane Doe',
    email: 'jane@example.com',
    phoneNumber: '254700000000',
    settlementMethod: 'MPESA',
    settlementAccount: '254700000000',
    status: ParticipantStatus.DOCUMENTS_SUBMITTED,
    payment,
    integrations,
  };
}

function createRepository(participant: any) {
  const repository = Object.create(OnbordingsRepository.prototype) as OnbordingsRepository;
  const prisma = {
    onboardingParticipant: {
      findUnique: async () => participant,
      update: async ({ data }: any) => Object.assign(participant, data),
    },
    integration: {
      create: async ({ data }: any) => {
        const integration = { id: 'integration-1', ...data, createdAt: new Date() };
        participant.integrations = [integration];
        return integration;
      },
      update: async ({ where, data }: any) => {
        const integration = participant.integrations.find((item: any) => item.id === where.id);
        return Object.assign(integration, data);
      },
    },
  };
  Object.defineProperty(repository, 'prisma', { value: prisma });
  return repository;
}

test('activating a verified payment activates the participant when credentials already exist', async () => {
  const paymentActivationSecret = 'paysec_valid';
  const participant = createCompleteParticipant(
    {
      status: 'PENDING_VERIFICATION',
      paymentActivationSecretHash: createHash('sha256').update(paymentActivationSecret).digest('hex'),
      paymentActivationSecretExpiresAt: new Date(Date.now() + 10_000).toISOString(),
    },
    [{
      id: 'integration-1',
      apiKey: 'pk_live_test',
      apiSecret: 'sk_live_test',
      isActive: false,
    }],
  );
  const repository = createRepository(participant);

  const activated = await repository.activatePayment(participant.id, paymentActivationSecret);

  assert.ok(activated);
  assert.equal(activated.status, ParticipantStatus.ACTIVE);
  assert.equal((activated.payment as any).status, 'VERIFIED');
  assert.equal(activated.integrations[0].isActive, true);
});

test('generating credentials activates the participant when payment was already verified', async () => {
  const participant = createCompleteParticipant({
    status: 'VERIFIED',
    isVerified: true,
  });
  const repository = createRepository(participant);

  await repository.createIntegrationForParticipant(participant.id, {});

  assert.equal(participant.status, ParticipantStatus.ACTIVE);
  assert.equal(participant.integrations[0].isActive, true);
});
