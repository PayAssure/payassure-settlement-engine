import { OnboardingResponseDto } from '../dto/onboarding-response.dto';
import { PublicOnboardingResponseDto } from '../dto/public-onboarding-response.dto';
import { OnbordingsResponseDetailsBase } from './response-details.base';

export abstract class OnbordingsResponseMappingBase extends OnbordingsResponseDetailsBase {
  protected toPublicResponse(participant: any): PublicOnboardingResponseDto {
    const payment = participant.payment as any;
    const activeIntegration = participant.integrations?.[0];
    return {
      id: participant.id,
      participantType: participant.participantType,
      businessName: participant.businessName,
      businessType: participant.businessType,
      contactName: participant.contactName,
      email: participant.email,
      status: participant.status,
      integration: activeIntegration
        ? {
            merchantId: activeIntegration.merchantId,
            apiKey: activeIntegration.apiKey ?? '',
            apiSecret: activeIntegration.apiSecret ?? '',
            environment: activeIntegration.environment,
            isActive: activeIntegration.isActive,
          }
        : null,
      payment: payment
        ? {
            type: payment.type,
            accountName: payment.accountName,
            status: payment.status,
            isVerified: payment.isVerified,
            provider: payment.provider,
            ...(payment.type === 'MPESA' ? { phoneNumber: payment.phoneNumber } : {}),
            ...(payment.type === 'BANK' ? { bankCode: payment.bankCode, accountNumber: payment.accountNumber, shortcode: payment.shortcode } : {}),
          }
        : null,
      createdAt: participant.createdAt,
      updatedAt: participant.updatedAt,
    };
  }

  protected toResponse(
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
      payment: this.toSafePaymentResponse(participant.payment),
      createdAt: participant.createdAt,
      updatedAt: participant.updatedAt,
    };
  }
}
