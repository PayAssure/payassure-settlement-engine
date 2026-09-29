import { OnbordingsIntegrationManagementBase } from './integration-management.base';

export abstract class OnbordingsRepositoryLifecycleBase extends OnbordingsIntegrationManagementBase {
  async onModuleDestroy() {
    await this.prisma.$disconnect();
  }
}
