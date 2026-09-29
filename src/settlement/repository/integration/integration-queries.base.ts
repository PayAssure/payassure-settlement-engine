import { IntegrationContextBase } from './integration-context.base';

export abstract class IntegrationQueriesBase extends IntegrationContextBase {
  async findIntegrationById(id: string) {
    return this.prisma.integration.findUnique({ where: { id }, include: { participant: true } });
  }

  async findIntegrationByParticipantId(participantId: string) {
    return this.prisma.integration.findFirst({
      where: { participantId, isActive: true },
      include: { participant: true },
      orderBy: { createdAt: 'desc' },
    });
  }

  async findIntegrationByMerchantId(merchantId: string) {
    return this.prisma.integration.findFirst({ where: { merchantId, isActive: true }, include: { participant: true } });
  }
}
