import { TransactionStatus } from '@prisma/client';
import { TransactionContextBase } from './transaction-context.base';

export abstract class TransactionWritesBase extends TransactionContextBase {
  async createTransaction(settlementId: string, itemId: string, supplierMerchantId: string, type: string, amount: number, quantity?: number, unitPrice?: number, description?: string) {
    return this.prisma.transaction.create({ data: { settlementId, itemId, supplierMerchantId, type: type.toUpperCase() as any, amount, quantity: quantity ?? 0, unitPrice: unitPrice ?? 0, description, status: TransactionStatus.INITIATED } });
  }

  async createMultipleTransactions(settlementId: string, items: Array<{ itemId: string; supplierMerchantId: string; type: string; amount: number; quantity?: number; unitPrice?: number; description?: string; }>) {
    const transactions = [];
    for (const item of items) {
      transactions.push(await this.createTransaction(settlementId, item.itemId, item.supplierMerchantId, item.type, item.amount, item.quantity, item.unitPrice, item.description));
    }
    return transactions;
  }
}
