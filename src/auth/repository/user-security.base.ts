import { AuthOnboardingAccessBase } from './onboarding-access.base';

export abstract class AuthUserSecurityBase extends AuthOnboardingAccessBase {
  async incrementRefreshTokenVersion(userId: string) {
    return this.prisma.user.update({
      where: { id: userId },
      data: { refreshTokenVersion: { increment: 1 } },
    });
  }

  async updatePassword(userId: string, passwordHash: string) {
    return this.prisma.user.update({
      where: { id: userId },
      data: { passwordHash },
    });
  }
}
