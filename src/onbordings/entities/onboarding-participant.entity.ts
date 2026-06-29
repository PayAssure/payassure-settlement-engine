export class OnboardingParticipantEntity {
  id: string = '';
  participantType: string = '';
  businessName: string = '';
  registrationNumber?: string | null = null;
  kraPin?: string | null = null;
  businessType?: string | null = null;
  industry?: string | null = null;
  physicalAddress?: string | null = null;
  contactName?: string | null = null;
  email?: string | null = null;
  phoneNumber?: string | null = null;
  settlementMethod?: string | null = null;
  settlementAccount?: string | null = null;
  posSystem?: string | null = null;
  webhookUrl?: string | null = null;
  settlementPreference?: string | null = null;
  status: string = '';
  createdAt: Date = new Date();
  updatedAt: Date = new Date();
}
