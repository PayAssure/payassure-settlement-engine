import { PrismaClient } from '@prisma/client';

export class IntegrationRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async findIntegrationById(id: string) {
    return this.prisma.integration.findUnique({ where: { id }, include: { participant: true } });
  }

  async findIntegrationByMerchantId(merchantId: string) {
    return this.prisma.integration.findFirst({ where: { merchantId, isActive: true }, include: { participant: true } });
  }
}
