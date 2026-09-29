import { SettlementHelloQueryBase } from './hello-query.base';

export abstract class SettlementSessionOperationsBase extends SettlementHelloQueryBase {
  async createSettlementSession(businessId: string, integrationId: string, token: string, expiresAt: Date) {
    return this.sessions.createSettlementSession(businessId, integrationId, token, expiresAt);
  }

  async findSettlementSessionByToken(token: string) {
    return this.sessions.findSettlementSessionByToken(token);
  }

  async markSessionAsUsed(sessionId: string) {
    return this.sessions.touchSession(sessionId);
  }
}
