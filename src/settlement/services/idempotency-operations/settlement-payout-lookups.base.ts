import { PayoutLookupsBase } from './payout-lookups.base';

export abstract class SettlementPayoutLookupsBase extends PayoutLookupsBase {
  async getPayoutAttempt(idempotencyKey: string): Promise<any> {
    return this.prisma.b2BPayoutAttempt.findUnique({ where: { idempotencyKey } });
  }

  async getSettlementPayouts(settlementId: string): Promise<any[]> {
    return this.prisma.b2BPayoutAttempt.findMany({
      where: { settlementId },
      orderBy: { createdAt: 'desc' },
    });
  }
}
