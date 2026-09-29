import { AuthRepositoryContextBase } from './auth-repository-context.base';
import { UserRole } from '@prisma/client';

export abstract class AuthUserLookupBase extends AuthRepositoryContextBase {
  async createUser(data: { username: string; email: string; passwordHash: string; role: UserRole }) {
    return this.prisma.user.create({ data });
  }

  async findByIdentifier(identifier: string) {
    return this.prisma.user.findFirst({
      where: {
        OR: [{ email: identifier }, { username: identifier }],
      },
    });
  }

  async findByEmail(email: string) {
    return this.prisma.user.findUnique({ where: { email } });
  }
}
