import { AuthPasswordResetLookupBase } from './password-reset-lookup.base';

export abstract class AuthPasswordResetMutationsBase extends AuthPasswordResetLookupBase {
  async deletePasswordResetTokens(userId: string) {
    return this.prisma.passwordResetToken.deleteMany({ where: { userId } });
  }

  async consumePasswordResetToken(id: string) {
    return this.prisma.passwordResetToken.updateMany({
      where: { id, usedAt: null, expiresAt: { gt: new Date() } },
      data: { usedAt: new Date() },
    });
  }
}
