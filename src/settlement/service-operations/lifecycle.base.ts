import { SettlementRetryManagementBase } from './retry-management.base';

export abstract class SettlementServiceLifecycleBase extends SettlementRetryManagementBase {
  async onModuleDestroy() {
    await this.prisma.$disconnect();
  }
}
