import { AuthContextBase } from './auth-context.base';

export abstract class AuthProfileBase extends AuthContextBase {
  protected async getProfileStatus(email: string) {
    const onboarding = await this.repository.findOnboardedByEmail(email);
    const profileComplete = this.isProfileComplete(onboarding);

    return {
      profileComplete,
      message: profileComplete
        ? 'Profile complete.'
        : 'Your profile is incomplete. Please finish onboarding to get API keys access.',
    };
  }

  protected isProfileComplete(onboarding: any): boolean {
    if (!onboarding) {
      return false;
    }

    const requiredFields = [
      onboarding.participantType,
      onboarding.businessName,
      onboarding.contactName,
      onboarding.email,
      onboarding.phoneNumber,
      onboarding.settlementMethod,
      onboarding.settlementAccount,
    ];

    return requiredFields.every((value) => Boolean(value) && (!String(value).trim || String(value).trim().length > 0));
  }
}
