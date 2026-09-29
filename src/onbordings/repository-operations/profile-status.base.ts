import { InternalServerErrorException } from '@nestjs/common';
import { ParticipantStatus } from '@prisma/client';
import { CreateOnboardingDto } from '../dto/create-onboarding.dto';
import { OnbordingsRepositoryContextBase } from './repository-context.base';

export abstract class OnbordingsProfileStatusBase extends OnbordingsRepositoryContextBase {
  protected validateCredentials(merchantId: string, apiKey: string, apiSecret: string) {
    if (!merchantId || !apiKey || !apiSecret) {
      throw new InternalServerErrorException('Invalid API credential data generated. No partial credentials were persisted.');
    }
  }

  protected getStatusForProfile(data: Partial<CreateOnboardingDto>): ParticipantStatus {
    const requiredFields = ['participantType', 'businessName', 'contactName', 'email', 'phoneNumber', 'settlementMethod', 'settlementAccount'] as const;
    const isComplete = requiredFields.every((field) => {
      const value = data[field];
      return typeof value === 'string' ? value.trim().length > 0 : Boolean(value);
    });
    return isComplete ? ParticipantStatus.DOCUMENTS_SUBMITTED : ParticipantStatus.DRAFT;
  }
}
