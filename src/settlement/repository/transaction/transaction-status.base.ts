import { TransactionStatus } from '@prisma/client';
import { TransactionQueriesBase } from './transaction-queries.base';

export abstract class TransactionStatusBase extends TransactionQueriesBase {
  async updateTransactionStatus(id: string, status: TransactionStatus) {
    return this.prisma.transaction.update({ where: { id }, data: { status, completedAt: status === TransactionStatus.COMPLETED ? new Date() : null } });
  }
}
