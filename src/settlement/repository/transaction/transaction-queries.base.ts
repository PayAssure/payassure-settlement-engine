import { TransactionWritesBase } from './transaction-writes.base';

export abstract class TransactionQueriesBase extends TransactionWritesBase {
  async findTransactionById(id: string) {
    return this.prisma.transaction.findUnique({ where: { id } });
  }

  async findTransactionsBySettlementId(settlementId: string) {
    return this.prisma.transaction.findMany({ where: { settlementId }, orderBy: { createdAt: 'asc' } });
  }
}
