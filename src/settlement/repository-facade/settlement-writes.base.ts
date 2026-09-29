import { SettlementIntegrationOperationsBase } from './integration-operations.base';

export abstract class SettlementWritesBase extends SettlementIntegrationOperationsBase {
  async createSettlement(businessId: string, integrationId: string, payAssureReference: string, internalMerchantTransactionReference: string, data: any) {
    return this.settlements.createSettlement(businessId, integrationId, payAssureReference, internalMerchantTransactionReference, data);
  }

  async createSupplierSettlement(businessId: string, integrationId: string, data: any) {
    return this.settlements.createSupplierSettlement(businessId, integrationId, data);
  }
}
