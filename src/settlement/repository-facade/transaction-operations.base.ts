import { SettlementStatusBase } from './settlement-status.base';

export abstract class SettlementTransactionOperationsBase extends SettlementStatusBase {
  async createTransaction(settlementId: string, itemId: string, supplierMerchantId: string, type: string, amount: number, quantity?: number, unitPrice?: number, description?: string) {
    return this.transactions.createTransaction(settlementId, itemId, supplierMerchantId, type, amount, quantity, unitPrice, description);
  }

  async findTransactionById(id: string) {
    return this.transactions.findTransactionById(id);
  }

  async findTransactionsBySettlementId(settlementId: string) {
    return this.transactions.findTransactionsBySettlementId(settlementId);
  }
}
