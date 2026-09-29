import { PayoutRetryStateBase } from './retry-state.base';

export abstract class PayoutLookupsBase extends PayoutRetryStateBase {
  async getPayoutAttemptByReference(payoutReference: string): Promise<any | null> {
    return this.prisma.b2BPayoutAttempt.findUnique({ where: { payoutReference } });
  }

  async getPendingRetries(): Promise<any[]> {
    return this.prisma.b2BPayoutAttempt.findMany({
      where: { status: { in: ['FAILED', 'RETRYING'] }, nextRetryAt: { lte: new Date() } },
      orderBy: { nextRetryAt: 'asc' },
    });
  }
}
