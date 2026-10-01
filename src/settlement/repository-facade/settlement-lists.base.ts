import { SettlementPayoutLookupsBase } from './payout-lookups.base';

export abstract class SettlementListsBase extends SettlementPayoutLookupsBase {
  async findSettlementsByMerchantId(merchantId: string, integrationId?: string, from?: Date, to?: Date, status?: string) {
    return this.settlements.findSettlementsByMerchantId(merchantId, integrationId, from, to, status);
  }

  async findSettlementsByIntegrationId(integrationId: string, from?: Date, to?: Date) {
    return this.settlements.findSettlementsByIntegrationId(integrationId, from, to);
  }

  async findSettlementsBySupplierMerchantId(merchantId: string) {
    return this.settlements.findSettlementsBySupplierMerchantId(merchantId);
  }
}
