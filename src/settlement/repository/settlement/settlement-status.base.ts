import { SettlementStatus } from '@prisma/client';
import { SettlementListBase } from './settlement-list.base';

export abstract class SettlementStatusBase extends SettlementListBase {
  async updateSettlementStatus(id: string, status: SettlementStatus, updates?: Record<string, any>) {
    return this.prisma.settlement.update({ where: { id }, data: { status, ...updates } });
  }

  async updateSettlementReconciliation(id: string, bankReference: string, bankTransactionId?: string) {
    return this.prisma.settlement.update({
      where: { id },
      data: { status: SettlementStatus.COMPLETED, reconciliationStatus: 'VERIFIED', bankReference, bankTransactionId, reconciliedAt: new Date(), completedAt: new Date() },
    });
  }
}
