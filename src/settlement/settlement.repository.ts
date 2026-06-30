import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { PrismaClient, SettlementStatus, TransactionStatus, Hello } from '@prisma/client';
import { InitiateSettlementDto } from './dto/initiate-settlement.dto';

@Injectable()
export class SettlementRepository implements OnModuleDestroy {
  private prisma = new PrismaClient();

  async findFirstHello(): Promise<Hello | null> {
    return this.prisma.hello.findFirst();
  }

  // SettlementSession Methods
  async createSettlementSession(
    businessId: string,
    integrationId: string,
    token: string,
    expiresAt: Date,
  ) {
    return this.prisma.settlementSession.create({
      data: {
        businessId,
        integrationId,
        token,
        expiresAt,
      },
    });
  }

  async findSettlementSessionByToken(token: string) {
    return this.prisma.settlementSession.findUnique({
      where: { token },
    });
  }

  async markSessionAsUsed(sessionId: string) {
    return this.prisma.settlementSession.update({
      where: { id: sessionId },
      data: {
        isUsed: true,
        usedAt: new Date(),
      },
    });
  }

  async deleteExpiredSessions() {
    return this.prisma.settlementSession.deleteMany({
      where: {
        expiresAt: {
          lt: new Date(),
        },
      },
    });
  }

  // Settlement Methods
  async createSettlement(
    businessId: string,
    integrationId: string,
    data: InitiateSettlementDto,
  ) {
    return this.prisma.settlement.create({
      data: {
        businessId,
        integrationId,
        amount: data.amount,
        currency: data.currency,
        settlementMethod: data.settlementMethod,
        settlementAccount: data.settlementAccount,
        reference: data.reference,
        description: data.description,
        metadata: data.metadata,
        status: SettlementStatus.INITIATED,
      },
    });
  }

  async findSettlementById(id: string) {
    return this.prisma.settlement.findUnique({
      where: { id },
      include: {
        transactions: true,
      },
    });
  }

  async findSettlementByBusinessAndReference(businessId: string, reference: string) {
    return this.prisma.settlement.findUnique({
      where: {
        businessId_reference: {
          businessId,
          reference,
        },
      },
    });
  }

  async findSettlementsByBusinessId(businessId: string, skip = 0, take = 10) {
    return this.prisma.settlement.findMany({
      where: { businessId },
      include: { transactions: true },
      skip,
      take,
      orderBy: { createdAt: 'desc' },
    });
  }

  async updateSettlementStatus(id: string, status: SettlementStatus, updates?: Record<string, any>) {
    return this.prisma.settlement.update({
      where: { id },
      data: {
        status,
        ...updates,
      },
    });
  }

  async updateSettlementReconciliation(
    id: string,
    bankReference: string,
    bankTransactionId?: string,
  ) {
    return this.prisma.settlement.update({
      where: { id },
      data: {
        status: SettlementStatus.COMPLETED,
        reconciliationStatus: 'VERIFIED',
        bankReference,
        bankTransactionId,
        reconciliedAt: new Date(),
        completedAt: new Date(),
      },
    });
  }

  // Transaction Methods
  async createTransaction(
    settlementId: string,
    itemId: string,
    type: string,
    amount: number,
    description?: string,
  ) {
    return this.prisma.transaction.create({
      data: {
        settlementId,
        itemId,
        type: type.toUpperCase() as any,
        amount,
        description,
        status: TransactionStatus.INITIATED,
      },
    });
  }

  async findTransactionById(id: string) {
    return this.prisma.transaction.findUnique({
      where: { id },
    });
  }

  async findTransactionsBySettlementId(settlementId: string) {
    return this.prisma.transaction.findMany({
      where: { settlementId },
      orderBy: { createdAt: 'asc' },
    });
  }

  async updateTransactionStatus(id: string, status: TransactionStatus) {
    return this.prisma.transaction.update({
      where: { id },
      data: {
        status,
        completedAt: status === TransactionStatus.COMPLETED ? new Date() : null,
      },
    });
  }

  // Bulk transaction creation
  async createMultipleTransactions(
    settlementId: string,
    items: Array<{ itemId: string; type: string; amount: number; description?: string }>,
  ) {
    const transactions = [];
    for (const item of items) {
      const transaction = await this.createTransaction(
        settlementId,
        item.itemId,
        item.type,
        item.amount,
        item.description,
      );
      transactions.push(transaction);
    }
    return transactions;
  }

  async onModuleDestroy() {
    await this.prisma.$disconnect();
  }
}
