import { SettlementReadBase } from './settlement-read.base';

export abstract class SettlementListBase extends SettlementReadBase {
  async findSettlementsByMerchantId(merchantId: string, integrationId?: string, from?: Date, to?: Date, status?: string) {
    return this.prisma.settlement.findMany({
      where: {
        OR: [
          ...(integrationId ? [{ integrationId }] : []),
          { transactions: { some: { supplierMerchantId: merchantId } } },
        ],
        ...(status ? { status: status as any } : {}),
        ...(from || to ? { createdAt: { ...(from ? { gte: from } : {}), ...(to ? { lt: to } : {}) } } : {}),
      },
      include: { transactions: true },
      orderBy: { createdAt: 'desc' },
    });
  }

  async findSettlementsByIntegrationId(integrationId: string, from?: Date, to?: Date) {
    return this.prisma.settlement.findMany({
      where: {
        integrationId,
        ...(from || to ? { createdAt: { ...(from ? { gte: from } : {}), ...(to ? { lt: to } : {}) } } : {}),
      },
      include: { transactions: true },
      orderBy: { createdAt: 'desc' },
    });
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
}
