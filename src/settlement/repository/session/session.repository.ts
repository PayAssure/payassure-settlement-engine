import { PrismaClient } from '@prisma/client';

export class SessionRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async createSettlementSession(businessId: string, integrationId: string, token: string, expiresAt: Date) {
    return this.prisma.settlementSession.create({ data: { businessId, integrationId, token, expiresAt } });
  }

  async findSettlementSessionByToken(token: string) {
    return this.prisma.settlementSession.findUnique({ where: { token } });
  }

  async markSessionAsUsed(sessionId: string) {
    return this.prisma.settlementSession.update({ where: { id: sessionId }, data: { isUsed: true, usedAt: new Date() } });
  }

  async deleteExpiredSessions() {
    return this.prisma.settlementSession.deleteMany({ where: { expiresAt: { lt: new Date() } } });
  }
}
