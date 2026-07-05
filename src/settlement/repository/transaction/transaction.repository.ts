import { PrismaClient, TransactionStatus } from '@prisma/client';

export class TransactionRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async createTransaction(settlementId: string, itemId: string, supplierMerchantId: string, type: string, amount: number, quantity?: number, unitPrice?: number, description?: string) {
    return this.prisma.transaction.create({ data: { settlementId, itemId, supplierMerchantId, type: type.toUpperCase() as any, amount, quantity: quantity ?? 0, unitPrice: unitPrice ?? 0, description, status: TransactionStatus.INITIATED } });
  }

  async findTransactionById(id: string) {
    return this.prisma.transaction.findUnique({ where: { id } });
  }

  async findTransactionsBySettlementId(settlementId: string) {
    return this.prisma.transaction.findMany({ where: { settlementId }, orderBy: { createdAt: 'asc' } });
  }

  async updateTransactionStatus(id: string, status: TransactionStatus) {
    return this.prisma.transaction.update({ where: { id }, data: { status, completedAt: status === TransactionStatus.COMPLETED ? new Date() : null } });
  }

  async createMultipleTransactions(settlementId: string, items: Array<{ itemId: string; supplierMerchantId: string; type: string; amount: number; quantity?: number; unitPrice?: number; description?: string; }>) {
    const transactions = [];
    for (const item of items) {
      transactions.push(await this.createTransaction(settlementId, item.itemId, item.supplierMerchantId, item.type, item.amount, item.quantity, item.unitPrice, item.description));
    }
    return transactions;
  }
}
