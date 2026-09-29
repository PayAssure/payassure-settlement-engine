import { CreateOnboardingDto } from '../dto/create-onboarding.dto';
import { OnbordingsResponseMappingBase } from './response-mapping.base';

export abstract class OnbordingsProfileRulesBase extends OnbordingsResponseMappingBase {
  protected isProfileIncomplete(data: CreateOnboardingDto): boolean {
    const requiredFields = [data.participantType, data.businessName, data.contactName, data.email, data.phoneNumber, data.settlementMethod, data.settlementAccount];
    return requiredFields.some((value) => !value || (typeof value === 'string' && value.trim().length === 0));
  }

  protected shouldReuseParticipant(existingParticipant: any, data: CreateOnboardingDto): boolean {
    if (!existingParticipant || existingParticipant.participantType !== data.participantType) return false;
    const comparableFields = [
      'businessName', 'registrationNumber', 'kraPin', 'businessType', 'industry', 'physicalAddress',
      'contactName', 'phoneNumber', 'settlementMethod', 'settlementAccount', 'posSystem', 'settlementPreference',
    ] as const;
    return comparableFields.every((field) => (existingParticipant[field] ?? null) === (data[field] ?? null));
  }
}
