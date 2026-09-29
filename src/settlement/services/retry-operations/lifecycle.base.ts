import { RetryStatisticsBase } from './statistics.base';

export abstract class RetryLifecycleBase extends RetryStatisticsBase {
  async onModuleDestroy() {
    await this.prisma.$disconnect();
  }
}
