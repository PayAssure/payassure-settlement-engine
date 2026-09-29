import { SettlementReferenceLookupsBase } from './reference-lookups.base';

export abstract class SettlementReadBase extends SettlementReferenceLookupsBase {
  async findSettlementById(id: string) {
    return this.prisma.settlement.findUnique({ where: { id }, include: { transactions: true } });
  }

  async findSettlementByBusinessAndPayloadReference(businessId: string, payloadMerchantTransactionReference: string) {
    try {
      return await this.prisma.settlement.findFirst({
        where: { businessId, metadata: { path: ['originalMerchantReference'], equals: payloadMerchantTransactionReference } },
        include: { transactions: true },
      });
    } catch (err) {
      const msg = (err as any)?.message ? String((err as any).message) : String(err);
      if (msg.includes('does not exist') || msg.includes('column') || msg.includes('merchantTransactionReference')) {
        // @ts-ignore
        const rows: Array<{ id: string }> = await this.prisma.$queryRaw`SELECT id FROM "Settlement" WHERE "businessId" = ${businessId} AND metadata->>'originalMerchantReference' = ${payloadMerchantTransactionReference} LIMIT 1`;
        if (rows && rows.length > 0) {
          return this.prisma.settlement.findUnique({ where: { id: rows[0].id }, include: { transactions: true } });
        }
        return null;
      }
      throw err;
    }
  }

  async findSettlementsByBusinessId(businessId: string, skip = 0, take = 10) {
    return this.prisma.settlement.findMany({ where: { businessId }, include: { transactions: true }, skip, take, orderBy: { createdAt: 'desc' } });
  }
}
