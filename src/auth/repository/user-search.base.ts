import { AuthUserLookupBase } from './user-lookup.base';

export abstract class AuthUserSearchBase extends AuthUserLookupBase {
  async findByUsername(username: string) {
    return this.prisma.user.findUnique({ where: { username } });
  }

  async findByEmailOrUsername(username: string, email: string) {
    return this.prisma.user.findFirst({
      where: {
        OR: [{ email }, { username }],
      },
    });
  }

  async findById(id: string) {
    return this.prisma.user.findUnique({ where: { id } });
  }
}
