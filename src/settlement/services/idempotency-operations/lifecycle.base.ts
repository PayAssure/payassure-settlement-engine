import { SettlementPayoutLookupsBase } from './settlement-payout-lookups.base';

export abstract class PayoutIdempotencyLifecycleBase extends SettlementPayoutLookupsBase {
  async onModuleDestroy() {
    await this.prisma.$disconnect();
  }
}
