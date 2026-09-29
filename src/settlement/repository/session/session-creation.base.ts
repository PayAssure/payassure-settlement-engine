import { SessionContextBase } from './session-context.base';

export abstract class SessionCreationBase extends SessionContextBase {
  async createSettlementSession(businessId: string, integrationId: string, token: string, expiresAt: Date) {
    return this.prisma.settlementSession.create({ data: { businessId, integrationId, token, expiresAt, status: 'ACTIVE' } });
  }

  async findSettlementSessionByToken(token: string) {
    return this.prisma.settlementSession.findUnique({ where: { token } });
  }
}
