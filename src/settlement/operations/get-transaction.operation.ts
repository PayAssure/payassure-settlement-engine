import { NotFoundException } from '@nestjs/common';

export async function getTransactionOperation(repository: any, transactionId: string) {
  const transaction = await repository.findTransactionById(transactionId);
  if (!transaction) {
    throw new NotFoundException({ statusCode: 404, message: 'Transaction not found', error: 'TRANSACTION_NOT_FOUND' });
  }

  return {
    success: true,
    transaction: {
      transactionId: transaction.id,
      settlementId: transaction.settlementId,
      itemId: transaction.itemId,
      type: transaction.type,
      amount: Number(transaction.amount),
      currency: 'KES',
      status: transaction.status,
      description: transaction.description,
      createdAt: transaction.createdAt,
      completedAt: transaction.completedAt,
    },
  };
}
