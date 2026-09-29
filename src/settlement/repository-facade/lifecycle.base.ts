import { SettlementTransactionManagementBase } from './transaction-management.base';

export abstract class SettlementRepositoryLifecycleBase extends SettlementTransactionManagementBase {
  async onModuleDestroy() {
    await this.prisma.$disconnect();
  }
}
