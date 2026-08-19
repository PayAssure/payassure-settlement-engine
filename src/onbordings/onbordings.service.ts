import { ForbiddenException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { createHash, randomBytes } from 'crypto';
import { ParticipantStatus } from '@prisma/client';
import { CreateIntegrationDto } from './dto/create-integration.dto';
import { CreateOnboardingDto } from './dto/create-onboarding.dto';
import { OnboardingResponseDto } from './dto/onboarding-response.dto';
import { PaymentMethodDto } from './dto/payment-method.dto';
import { UpdateOnboardingDto } from './dto/update-onboarding.dto';
import { OnbordingsRepository } from './onbordings.repository';

@Injectable()
export class OnbordingsService {
  private readonly logger = new Logger(OnbordingsService.name);

  constructor(private readonly repository: OnbordingsRepository) {}

  async createParticipant(data: CreateOnboardingDto): Promise<OnboardingResponseDto> {
    if (data.payment) {
      this.validatePaymentMethod(data.payment);
    }

    const preparedPayment = data.payment ? this.preparePaymentForStorage(data.payment) : undefined;
    const normalizedData = preparedPayment
      ? { ...data, payment: preparedPayment.payment }
      : data;

    const user = normalizedData.email ? await this.repository.findUserByEmail(normalizedData.email) : null;
    const existingParticipant = normalizedData.email ? await this.repository.findParticipantByEmail(normalizedData.email) : null;
    const completionMessage = user
      ? undefined
      : 'Onboarding created. Please register an account to complete your profile.';
    const draftReasonMessage = this.isProfileIncomplete(normalizedData)
      ? 'Your onboarding request is currently in draft because the profile is incomplete. Please complete the required details to move it forward.'
      : undefined;

    if (existingParticipant) {
      if (existingParticipant.participantType === normalizedData.participantType) {
        const duplicateMessage ='This onboarding request was not created because an onboarding record for the same participant type already exists for this user.';

        return this.toResponse(existingParticipant, undefined, duplicateMessage);
      }

      if (this.shouldReuseParticipant(existingParticipant, normalizedData)) {
        return this.toResponse(existingParticipant, undefined, completionMessage);
      }
    }

    const created = await this.repository.createParticipantWithoutIntegration(normalizedData);
    return this.toResponse(this.attachActivationSecret(created, preparedPayment?.paymentActivationSecret), undefined, draftReasonMessage ?? completionMessage);
  }

  async findAllParticipants(): Promise<OnboardingResponseDto[]> {
    const participants = await this.repository.findAllParticipants();
    return participants.map((participant) => this.toResponse(participant));
  }

  async findParticipantById(id: string): Promise<OnboardingResponseDto> {
    const participant = await this.repository.findParticipantById(id);
    if (!participant) {
      throw new NotFoundException('Participant not found');
    }

    return this.toResponse(participant);
  }

  async updateParticipant(id: string, data: UpdateOnboardingDto): Promise<OnboardingResponseDto> {
    if (data.payment) {
      this.validatePaymentMethod(data.payment);
    }

    const preparedPayment = data.payment ? this.preparePaymentForStorage(data.payment) : undefined;
    const normalizedData = preparedPayment
      ? { ...data, payment: preparedPayment.payment }
      : data;

    try {
      const participant = await this.repository.updateParticipant(id, normalizedData);
      return this.toResponse(this.attachActivationSecret(participant, preparedPayment?.paymentActivationSecret));
    } catch {
      throw new NotFoundException('Participant not found');
    }
  }

  async activateParticipant(id: string): Promise<OnboardingResponseDto> {
    const participant = await this.repository.activateParticipant(id);

    const integration = participant.integrations?.[0];
    const alreadyActive = integration?.isActive && participant.status === ParticipantStatus.ACTIVE;

    return this.toResponse(
      participant,
      undefined,
      alreadyActive
        ? 'Business is already active.'
        : 'Business activation successful. Integration is now active.',
    );
  }

  async deleteParticipant(id: string): Promise<void> {
    try {
      await this.repository.deleteParticipant(id);
    } catch {
      throw new NotFoundException('Participant not found');
    }
  }

  async createIntegration(id: string, data: CreateIntegrationDto) {
    const participant = await this.repository.findParticipantById(id);
    if (!participant) {
      throw new NotFoundException('Participant not found');
    }

    return this.repository.createIntegrationForParticipant(id, data);
  }

  async generateApiKeys(user: any): Promise<OnboardingResponseDto> {
    const participant = await this.repository.findParticipantByEmail(user.email);
    if (!participant) {
      throw new NotFoundException('Onboarding participant not found for the authenticated user');
    }

    const existingIntegration = participant.integrations?.[0];
    if (existingIntegration) {
      if (existingIntegration.apiKey && existingIntegration.apiSecret) {
        const credentials = {
          merchantId: existingIntegration.merchantId,
          apiKey: existingIntegration.apiKey,
          apiSecret: existingIntegration.apiSecret,
        };

        return this.toResponse(
          participant,
          credentials,
          'API keys were not generated because they already exist. Use the existing credentials.',
        );
      }

      const regenerated = await this.repository.regenerateIntegrationCredentials(existingIntegration.id);
      const participantWithIntegration = await this.repository.findParticipantById(participant.id);
      return this.toResponse(
        participantWithIntegration,
        regenerated,
        'API keys were generated and persisted because previous credentials were missing.',
      );
    }

    const generated = await this.repository.createIntegrationForParticipant(participant.id, {});
    const participantWithIntegration = await this.repository.findParticipantById(participant.id);
    return this.toResponse(
      participantWithIntegration,
      generated,
      'These are the API keys generated for the first time.',
    );
  }

  async viewApiKeys(user: any): Promise<OnboardingResponseDto> {
    const participant = await this.repository.findParticipantByEmail(user.email);
    if (!participant) {
      throw new NotFoundException('Onboarding participant not found for the authenticated user');
    }

    const integration = participant.integrations?.[0];
    if (!integration || !integration.apiKey || !integration.apiSecret) {
      throw new NotFoundException('API keys not found for the authenticated user');
    }

    return this.toResponse(participant, {
      merchantId: integration.merchantId,
      apiKey: integration.apiKey,
      apiSecret: integration.apiSecret,
    });
  }

  async updateWebhook(id: string, webhookUrl: string): Promise<OnboardingResponseDto> {
    try {
      const participant = await this.repository.updateWebhook(id, webhookUrl);
      return this.toResponse(participant);
    } catch {
      throw new NotFoundException('Participant not found');
    }
  }

  async updatePayment(id: string, payment: PaymentMethodDto): Promise<OnboardingResponseDto> {
    this.validatePaymentMethod(payment);
    const preparedPayment = this.preparePaymentForStorage(payment);
    const participant = await this.repository.updatePayment(id, preparedPayment.payment);
    return this.toResponse(this.attachActivationSecret(participant, preparedPayment.paymentActivationSecret));
  }

  async updatePaymentForUser(user: any, payment: PaymentMethodDto): Promise<OnboardingResponseDto> {
    this.logger.log(`updatePaymentForUser invoked for user=${user?.email ?? 'unknown'}`);
    this.validatePaymentMethod(payment);
    const preparedPayment = this.preparePaymentForStorage(payment);
    const participant = await this.repository.findParticipantByEmail(user?.email ?? '');

    if (!participant) {
      this.logger.warn(`Authenticated user not found as onboarding participant: email=${user?.email ?? 'undefined'}`);
      throw new NotFoundException('Onboarding participant not found for the authenticated user');
    }

    this.logger.log(`Authenticated participant found: id=${participant.id}, email=${participant.email}`);
    const updatedParticipant = await this.repository.updatePayment(participant.id, preparedPayment.payment);
    this.logger.log(`Updated payment destination for participant id=${participant.id}`);
    return this.toResponse(this.attachActivationSecret(updatedParticipant, preparedPayment.paymentActivationSecret));
  }

  async activatePayment(user: any, data: { paymentActivationSecret: string }): Promise<OnboardingResponseDto> {
    const email = user?.email ?? '';
    this.logger.log(`activatePayment requested for authenticated user email=${email} sub=${user?.sub ?? 'unknown'}`);

    const participant = await this.repository.findParticipantByEmail(email);
    this.logger.log(`findParticipantByEmail returned ${participant ? `participant=${participant.id}` : 'no participant'} for email=${email}`);

    if (!participant) {
      this.logger.warn(`Authenticated user not found for payment activation using email=${email}`);
      throw new NotFoundException('Onboarding participant not found for the authenticated user');
    }

    const activatedParticipant = await this.repository.activatePayment(participant.id, data.paymentActivationSecret);
    return this.toResponse(activatedParticipant);
  }

  private validatePaymentMethod(payment: PaymentMethodDto) {
    if (!payment.type || !['MPESA', 'BANK'].includes(payment.type)) {
      throw new ForbiddenException('Payment type must be MPESA or BANK');
    }

    if (!payment.accountName) {
      throw new ForbiddenException('Payment accountName is required');
    }

    if (payment.isVerified !== undefined) {
      throw new ForbiddenException('isVerified is managed by the backend and must not be provided in the request payload');
    }

    if (payment.type === 'MPESA') {
      if (payment.bankCode || payment.accountNumber || payment.shortcode) {
        throw new ForbiddenException('MPESA payouts do not accept bankCode, accountNumber or shortcode in the request payload');
      }

      const mpesaPhoneNumber = payment.phoneNumber ?? payment.payerPhoneNumber;
      if (!mpesaPhoneNumber) {
        throw new ForbiddenException('phoneNumber is required for MPESA payout destinations');
      }
    }

    if (payment.type === 'BANK') {
      if (payment.phoneNumber || payment.payerPhoneNumber) {
        throw new ForbiddenException('BANK payouts do not accept phoneNumber in the request payload');
      }

      if (!payment.bankCode || !payment.accountNumber) {
        throw new ForbiddenException('bankCode and accountNumber are required for BANK payout destinations');
      }

      if (payment.shortcode !== undefined && !/^[0-9]+$/.test(payment.shortcode)) {
        throw new ForbiddenException('shortcode must contain only digits');
      }
    }

  }

  private preparePaymentForStorage(payment: PaymentMethodDto): { payment: PaymentMethodDto; paymentActivationSecret?: string } {
    const activationSecret = `paysec_${randomBytes(16).toString('hex')}`;
    const activationSecretHash = createHash('sha256').update(activationSecret).digest('hex');

    const normalizedPayment: PaymentMethodDto = {
      ...payment,
      phoneNumber: payment.phoneNumber ?? payment.payerPhoneNumber,
      payerPhoneNumber: undefined,
      status: 'PENDING_VERIFICATION',
      isVerified: false,
      paymentActivationSecretHash: activationSecretHash,
      paymentActivationSecretExpiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
      verificationAttempts: 0,
      verificationMethod: undefined,
      verifiedAt: undefined,
    } as PaymentMethodDto;

    return {
      payment: normalizedPayment,
      paymentActivationSecret: activationSecret,
    };
  }

  private attachActivationSecret(participant: any, paymentActivationSecret?: string) {
    if (!participant || !paymentActivationSecret) {
      return participant;
    }

    const existingPayment = participant.payment as any;
    if (!existingPayment) {
      return participant;
    }

    return {
      ...participant,
      payment: {
        ...existingPayment,
        paymentActivationSecret,
      },
    };
  }

  private isProfileIncomplete(data: CreateOnboardingDto): boolean {
    const requiredFields = [
      data.participantType,
      data.businessName,
      data.contactName,
      data.email,
      data.phoneNumber,
      data.settlementMethod,
      data.settlementAccount,
    ];

    return requiredFields.some((value) => !value || (typeof value === 'string' && value.trim().length === 0));
  }

  private shouldReuseParticipant(existingParticipant: any, data: CreateOnboardingDto): boolean {
    if (!existingParticipant) {
      return false;
    }

    if (existingParticipant.participantType !== data.participantType) {
      return false;
    }

    const comparableFields = [
      'businessName',
      'registrationNumber',
      'kraPin',
      'businessType',
      'industry',
      'physicalAddress',
      'contactName',
      'phoneNumber',
      'settlementMethod',
      'settlementAccount',
      'posSystem',
      'settlementPreference',
    ] as const;

    return comparableFields.every((field) => (existingParticipant[field] ?? null) === (data[field] ?? null));
  }

  private toResponse(
    participant: any,
    credentials?: { merchantId: string; apiKey: string; apiSecret: string },
    message?: string,
  ): OnboardingResponseDto {
    const activeIntegration = participant.integrations?.[0];

    return {
      message,
      id: participant.id,
      participantType: participant.participantType,
      businessName: participant.businessName,
      businessType: participant.businessType,
      contactName: participant.contactName,
      email: participant.email,
      status: participant.status,
      integration: activeIntegration
        ? {
            id: activeIntegration.id,
            merchantId: credentials?.merchantId ?? activeIntegration.merchantId,
            apiKey: credentials?.apiKey ?? activeIntegration.apiKey ?? '',
            apiSecret: credentials?.apiSecret ?? activeIntegration.apiSecret ?? '',
            environment: activeIntegration.environment,
            isActive: activeIntegration.isActive,
            createdAt: activeIntegration.createdAt,
          }
        : null,
      payment: participant.payment ?? null,
      createdAt: participant.createdAt,
      updatedAt: participant.updatedAt,
    };
  }
}
