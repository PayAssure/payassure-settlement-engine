import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { PrismaClient, Prisma, SettlementStatus, TransactionStatus, Settlement, Transaction, Hello } from '@prisma/client';
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

  async findIntegrationById(id: string) {
    return this.prisma.integration.findUnique({
      where: { id },
      include: { participant: true },
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
    payAssureReference: string,
    internalMerchantTransactionReference: string,
    data: InitiateSettlementDto,
  ) {
    const paymentPayload = {
      merchantTransactionReference: data.merchantTransactionReference,
      totalAmount: data.totalAmount,
      currency: data.currency,
      settlementMethod: data.settlementMethod,
      description: data.description ?? undefined,
      paymentMethod: {
        type: data.paymentMethod.type,
        payerPhoneNumber: data.paymentMethod.payerPhoneNumber,
        provider: data.paymentMethod.provider ?? undefined,
      },
      callbackUrl: data.callbackUrl ?? undefined,
      transactionDate: data.transactionDate,
      suppliers: data.suppliers.map((supplier) => ({
        supplierMerchantId: supplier.supplierMerchantId,
        supplierTotalAmount: supplier.supplierTotalAmount ?? undefined,
        retailerTotalAmount: supplier.retailerTotalAmount ?? undefined,
        platformFee: supplier.platformFee ?? undefined,
        items: supplier.items.map((item) => ({
          itemId: item.itemId,
          itemName: item.itemName ?? undefined,
          supplierAmount: item.supplierAmount,
          retailerAmount: item.retailerAmount ?? undefined,
          platformFee: item.platformFee ?? undefined,
          quantity: item.quantity ?? undefined,
          unitPrice: item.unitPrice ?? undefined,
          description: item.description ?? undefined,
        })),
      })),
      metadata: data.metadata ?? undefined,
    };

    return this.prisma.settlement.create({
      data: {
        businessId,
        integrationId,
        amount: data.totalAmount,
        currency: data.currency,
        settlementMethod: data.settlementMethod,
        reference: payAssureReference,
        merchantTransactionReference: internalMerchantTransactionReference,
        description: data.description ?? undefined,
        metadata: {
          originalMerchantReference: data.merchantTransactionReference,
          ...data.metadata,
        },
        paymentPayload,
        status: SettlementStatus.INITIATED,
      } as Prisma.SettlementCreateInput,
    });
  }

  async createSupplierSettlement(
    businessId: string,
    integrationId: string,
    data: {
      amount: number;
      currency: string;
      settlementMethod: string;
      reference: string;
      merchantTransactionReference: string;
      description?: string;
      metadata?: Record<string, any>;
      paymentSnapshot?: any;
    },
  ) {
    return this.prisma.settlement.create({
      data: {
        businessId,
        integrationId,
        amount: data.amount,
        currency: data.currency,
        settlementMethod: data.settlementMethod,
        reference: data.reference,
        merchantTransactionReference: data.merchantTransactionReference,
        description: data.description,
        metadata: data.metadata,
        paymentSnapshot: data.paymentSnapshot ?? undefined,
        status: SettlementStatus.INITIATED,
      } as Prisma.SettlementCreateInput,
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

  async findSettlementByBusinessAndPayloadReference(
    businessId: string,
    payloadMerchantTransactionReference: string,
  ): Promise<(Settlement & { transactions: Transaction[] }) | null> {
    try {
      return await this.prisma.settlement.findFirst({
        where: {
          businessId,
          metadata: {
            path: ['originalMerchantReference'],
            equals: payloadMerchantTransactionReference,
          },
        },
        include: { transactions: true },
      });
    } catch (err) {
      // If the DB is missing the expected column or the JSON operator fails,
      // fall back to a raw SQL lookup of the settlement id via JSON path,
      // then load the settlement by id (safer against missing columns).
      const msg = (err as any)?.message ? String((err as any).message) : String(err);
      if (msg.includes("does not exist") || msg.includes('column') || msg.includes('merchantTransactionReference')) {
        // parameterized raw query for Postgres - use Prisma tagged template to avoid SQL injection
        // The ts-ignore is to allow returning a typed row from $queryRaw in this environment
        // @ts-ignore
        const rows: Array<{ id: string }> = await this.prisma.$queryRaw`
          SELECT id FROM "Settlement"
          WHERE "businessId" = ${businessId}
            AND metadata->>'originalMerchantReference' = ${payloadMerchantTransactionReference}
          LIMIT 1
        `;

        if (rows && rows.length > 0) {
          const id = rows[0].id;
          return this.prisma.settlement.findUnique({ where: { id }, include: { transactions: true } });
        }
        return null;
      }

      throw err;
    }
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
    supplierMerchantId: string,
    type: string,
    amount: number,
    quantity?: number,
    unitPrice?: number,
    description?: string,
  ) {
    return this.prisma.transaction.create({
      data: {
        settlementId,
        itemId,
        supplierMerchantId,
        type: type.toUpperCase() as any,
        amount,
        quantity: quantity ?? 0,
        unitPrice: unitPrice ?? 0,
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
    items: Array<{
      itemId: string;
      supplierMerchantId: string;
      type: string;
      amount: number;
      quantity?: number;
      unitPrice?: number;
      description?: string;
    }>,
  ) {
    const transactions = [];
    for (const item of items) {
      const transaction = await this.createTransaction(
        settlementId,
        item.itemId,
        item.supplierMerchantId,
        item.type,
        item.amount,
        item.quantity,
        item.unitPrice,
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
