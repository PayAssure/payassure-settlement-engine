import { SettlementTransactionOperationsBase } from './transaction-operations.base';

export abstract class SettlementTransactionManagementBase extends SettlementTransactionOperationsBase {
  async updateTransactionStatus(id: string, status: any) {
    return this.transactions.updateTransactionStatus(id, status);
  }

  async createMultipleTransactions(settlementId: string, items: Array<any>) {
    return this.transactions.createMultipleTransactions(settlementId, items);
  }
}
