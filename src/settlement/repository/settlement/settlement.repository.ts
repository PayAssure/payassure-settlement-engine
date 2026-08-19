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
    const paymentMethod = {
      type: data.paymentMethod.type,
      payerPhoneNumber: String(data.paymentMethod.payerPhoneNumber ?? '').trim() || undefined,
      provider: data.paymentMethod.provider ?? undefined,
    };

    const paymentPayload = {
      merchantTransactionReference: data.merchantTransactionReference,
      merchantId: data.merchantId ?? undefined,
      totalAmount: data.totalAmount,
      currency: data.currency,
      settlementMethod: data.settlementMethod,
      description: data.description ?? undefined,
      paymentMethod,
      callbackUrl: data.callbackUrl ?? undefined,
      transactionDate: data.transactionDate,
      suppliers: data.suppliers.map((supplier) => ({
        supplierMerchantId: supplier.supplierMerchantId,
        supplierTotalAmount: supplier.supplierTotalAmount ?? undefined,
        retailerTotalAmount: supplier.retailerTotalAmount ?? undefined,
        platformFee: supplier.platformFee ?? undefined,
        items: (supplier.items ?? []).map((item) => ({
          itemId: item.itemId ?? item.itemReference ?? undefined,
          itemName: item.itemName ?? undefined,
          supplierAmount: item.supplierAmount ?? undefined,
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
          retailerMerchantId: data.merchantId ?? undefined,
          ...data.metadata,
        },
        paymentPayload,
        status: SettlementStatus.INITIATED,
      } as Prisma.SettlementCreateInput,
    });
  }

  async createSupplierSettlement(businessId: string, integrationId: string, data: { amount: number; currency: string; settlementMethod: string; reference: string; merchantTransactionReference: string; description?: string; metadata?: Record<string, any>; paymentSnapshot?: any; paymentPayload?: Record<string, any>; }) {
    return this.prisma.settlement.create({ data: { businessId, integrationId, amount: data.amount, currency: data.currency, settlementMethod: data.settlementMethod, reference: data.reference, merchantTransactionReference: data.merchantTransactionReference, description: data.description, metadata: data.metadata, paymentPayload: data.paymentPayload ?? undefined, paymentSnapshot: data.paymentSnapshot ?? undefined, status: SettlementStatus.INITIATED } as Prisma.SettlementCreateInput });
  }

  async findSettlementById(id: string) {
    return this.prisma.settlement.findUnique({ where: { id }, include: { transactions: true } });
  }

  async findSettlementByReference(reference: string): Promise<(Settlement & { transactions: Transaction[] }) | null> {
    const normalizedReference = String(reference ?? '').trim();
    if (!normalizedReference) {
      return null;
    }

    const strippedPaySuffix = normalizedReference.replace(/-pay_[^-]+$/i, '');
    const strippedTextSuffix = normalizedReference.replace(/-pay-[^-]+$/i, '');
    const strippedPrefixTxn = normalizedReference.replace(/^TXN-/, '');
    const strippedPrefixPastl = normalizedReference.replace(/^PASTL-/, '');
    const firstThreeParts = normalizedReference.split('-').slice(0, 3).join('-');

    const candidates = [
      normalizedReference,
      strippedPaySuffix,
      strippedTextSuffix,
      strippedPrefixTxn,
      strippedPrefixPastl,
      firstThreeParts,
    ].filter(Boolean);

    const metadataLookupFields = [
      'payoutReference',
      'latestPayoutReference',
      'lastPayoutCallback.reference',
      'originalMerchantReference',
      'parentMerchantTransactionReference',
      'merchantTransactionReference',
      'callbackIdentifier',
      'callbackToken',
      'callbackUrl',
    ];

    const uniqueCandidates = Array.from(new Set(candidates));

    for (const candidate of uniqueCandidates) {
      const settlement = await this.prisma.settlement.findFirst({
        where: {
          OR: [
            { reference: candidate },
            { merchantTransactionReference: candidate },
            { metadata: { path: ['originalMerchantReference'], equals: candidate } },
            { metadata: { path: ['parentMerchantTransactionReference'], equals: candidate } },
            { metadata: { path: ['payoutReference'], equals: candidate } },
            { metadata: { path: ['latestPayoutReference'], equals: candidate } },
            { metadata: { path: ['lastPayoutCallback', 'reference'], equals: candidate } },
            { metadata: { path: ['callbackIdentifier'], equals: candidate } },
            { metadata: { path: ['callbackToken'], equals: candidate } },
            { metadata: { path: ['callbackUrl'], equals: candidate } },
            { paymentPayload: { path: ['merchantTransactionReference'], equals: candidate } },
            ...(metadataLookupFields.includes('merchantTransactionReference') ? [{ metadata: { path: ['merchantTransactionReference'], equals: candidate } }] : []),
          ],
        },
        include: { transactions: true },
      });

      if (settlement) {
        return settlement;
      }
    }

    return null;
  }

  /**
   * Find settlement by B2B payout callback identifier (UUID from callback URL)
   * Searches through payoutDispatches metadata for matching callbackIdentifier
   */
  async findSettlementByPayoutCallbackIdentifier(callbackIdentifier: string): Promise<(Settlement & { transactions: Transaction[] }) | null> {
    const normalizedId = String(callbackIdentifier ?? '').trim();
    if (!normalizedId) {
      return null;
    }

    const matchesCallbackId = (value: any): boolean => {
      if (!value || typeof value !== 'object') {
        return false;
      }

      if (Array.isArray(value)) {
        return value.some((item) => matchesCallbackId(item));
      }

      if (value.callbackIdentifier === normalizedId || value.callbackToken === normalizedId) {
        return true;
      }

      for (const nestedValue of Object.values(value)) {
        if (matchesCallbackId(nestedValue)) {
          return true;
        }
      }

      return false;
    };

    const allSettlements = await this.prisma.settlement.findMany({
      include: { transactions: true },
      orderBy: { createdAt: 'desc' },
      take: 1000,
    });

    for (const settlement of allSettlements) {
      const metadata = settlement.metadata as any;
      if (!metadata) continue;

      if (matchesCallbackId(metadata)) {
        return settlement;
      }
    }

    return null;
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

  async findSettlementsBySupplierMerchantId(merchantId: string) {
    try {
      return await this.prisma.settlement.findMany({
        where: { metadata: { path: ['supplierMerchantId'], equals: merchantId } },
        orderBy: { createdAt: 'desc' },
      });
    } catch (err) {
      const msg = (err as any)?.message ? String((err as any).message) : String(err);
      if (msg.includes('does not exist') || msg.includes('column') || msg.includes('metadata')) {
        const rows: Array<{ id: string; reference: string; merchantTransactionReference: string; amount: string; status: string; metadata: any; createdAt: Date }> = await this.prisma.$queryRaw`SELECT id, reference, "merchantTransactionReference", amount, status, metadata, "createdAt" FROM "Settlement" WHERE metadata->>'supplierMerchantId' = ${merchantId} ORDER BY "createdAt" DESC`;
        return rows.map((row) => ({
          id: row.id,
          reference: row.reference,
          merchantTransactionReference: row.merchantTransactionReference,
          amount: Number(row.amount),
          status: row.status,
          metadata: row.metadata,
          createdAt: row.createdAt,
        }));
      }
      throw err;
    }
  }

  async updateSettlementStatus(id: string, status: SettlementStatus, updates?: Record<string, any>) {
    return this.prisma.settlement.update({ where: { id }, data: { status, ...updates } });
  }

  async updateSettlementReconciliation(id: string, bankReference: string, bankTransactionId?: string) {
    return this.prisma.settlement.update({ where: { id }, data: { status: SettlementStatus.COMPLETED, reconciliationStatus: 'VERIFIED', bankReference, bankTransactionId, reconciliedAt: new Date(), completedAt: new Date() } });
  }
}
