import { SettlementSessionMaintenanceBase } from './session-maintenance.base';

export abstract class SettlementIntegrationOperationsBase extends SettlementSessionMaintenanceBase {
  async findIntegrationById(id: string) {
    return this.integrations.findIntegrationById(id);
  }

  async findIntegrationByParticipantId(participantId: string) {
    return this.integrations.findIntegrationByParticipantId(participantId);
  }

  async findIntegrationByMerchantId(merchantId: string) {
    return this.integrations.findIntegrationByMerchantId(merchantId);
  }
}
