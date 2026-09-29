import { AuthUserSecurityBase } from './user-security.base';

export abstract class AuthPasswordResetLookupBase extends AuthUserSecurityBase {
  async createPasswordResetToken(data: { userId: string; tokenHash: string; expiresAt: Date }) {
    return this.prisma.passwordResetToken.create({ data });
  }

  async findPasswordResetToken(tokenHash: string) {
    return this.prisma.passwordResetToken.findUnique({
      where: { tokenHash },
      include: { user: true },
    });
  }
}
