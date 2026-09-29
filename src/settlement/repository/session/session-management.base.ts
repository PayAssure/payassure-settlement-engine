import { SessionCreationBase } from './session-creation.base';

export abstract class SessionManagementBase extends SessionCreationBase {
  async touchSession(sessionId: string) {
    return this.prisma.settlementSession.update({ where: { id: sessionId }, data: { lastUsedAt: new Date() } });
  }

  async deleteExpiredSessions() {
    return this.prisma.settlementSession.deleteMany({ where: { expiresAt: { lt: new Date() } } });
  }
}
