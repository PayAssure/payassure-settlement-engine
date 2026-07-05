import { PrismaClient, Prisma, SettlementStatus, Settlement, Transaction } from '@prisma/client';
import { InitiateSettlementDto } from '../../dto/initiate-settlement.dto';

export class SettlementRecordRepository {
  constructor(private readonly prisma: PrismaClient) {}

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
        metadata: { originalMerchantReference: data.merchantTransactionReference, ...data.metadata },
        paymentPayload,
        status: SettlementStatus.INITIATED,
      } as Prisma.SettlementCreateInput,
    });
  }

  async createSupplierSettlement(businessId: string, integrationId: string, data: { amount: number; currency: string; settlementMethod: string; reference: string; merchantTransactionReference: string; description?: string; metadata?: Record<string, any>; paymentSnapshot?: any; }) {
    return this.prisma.settlement.create({ data: { businessId, integrationId, amount: data.amount, currency: data.currency, settlementMethod: data.settlementMethod, reference: data.reference, merchantTransactionReference: data.merchantTransactionReference, description: data.description, metadata: data.metadata, paymentSnapshot: data.paymentSnapshot ?? undefined, status: SettlementStatus.INITIATED } as Prisma.SettlementCreateInput });
  }

  async findSettlementById(id: string) {
    return this.prisma.settlement.findUnique({ where: { id }, include: { transactions: true } });
  }

  async findSettlementByBusinessAndPayloadReference(businessId: string, payloadMerchantTransactionReference: string): Promise<(Settlement & { transactions: Transaction[] }) | null> {
    try {
      return await this.prisma.settlement.findFirst({ where: { businessId, metadata: { path: ['originalMerchantReference'], equals: payloadMerchantTransactionReference } }, include: { transactions: true } });
    } catch (err) {
      const msg = (err as any)?.message ? String((err as any).message) : String(err);
      if (msg.includes('does not exist') || msg.includes('column') || msg.includes('merchantTransactionReference')) {
        // @ts-ignore
        const rows: Array<{ id: string }> = await this.prisma.$queryRaw`SELECT id FROM "Settlement" WHERE "businessId" = ${businessId} AND metadata->>'originalMerchantReference' = ${payloadMerchantTransactionReference} LIMIT 1`;
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
    return this.prisma.settlement.findMany({ where: { businessId }, include: { transactions: true }, skip, take, orderBy: { createdAt: 'desc' } });
  }

  async updateSettlementStatus(id: string, status: SettlementStatus, updates?: Record<string, any>) {
    return this.prisma.settlement.update({ where: { id }, data: { status, ...updates } });
  }

  async updateSettlementReconciliation(id: string, bankReference: string, bankTransactionId?: string) {
    return this.prisma.settlement.update({ where: { id }, data: { status: SettlementStatus.COMPLETED, reconciliationStatus: 'VERIFIED', bankReference, bankTransactionId, reconciliedAt: new Date(), completedAt: new Date() } });
  }
}
