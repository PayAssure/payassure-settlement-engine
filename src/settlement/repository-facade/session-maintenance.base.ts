import { SettlementSessionOperationsBase } from './session-operations.base';

export abstract class SettlementSessionMaintenanceBase extends SettlementSessionOperationsBase {
  async touchSession(sessionId: string) {
    return this.sessions.touchSession(sessionId);
  }

  async deleteExpiredSessions() {
    return this.sessions.deleteExpiredSessions();
  }
}
