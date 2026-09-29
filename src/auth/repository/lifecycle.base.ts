import { AuthPasswordResetMutationsBase } from './password-reset-mutations.base';

export abstract class AuthRepositoryLifecycleBase extends AuthPasswordResetMutationsBase {
  async onModuleDestroy() {
    await this.prisma.$disconnect();
  }
}
