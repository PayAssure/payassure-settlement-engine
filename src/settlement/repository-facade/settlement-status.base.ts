import { SettlementListsBase } from './settlement-lists.base';

export abstract class SettlementStatusBase extends SettlementListsBase {
  async updateSettlementStatus(id: string, status: any, updates?: Record<string, any>) {
    return this.settlements.updateSettlementStatus(id, status, updates);
  }

  async updateSettlementReconciliation(id: string, bankReference: string, bankTransactionId?: string) {
    return this.settlements.updateSettlementReconciliation(id, bankReference, bankTransactionId);
  }
}
