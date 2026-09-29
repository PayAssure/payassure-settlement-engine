import { SettlementPayoutLookupsBase } from './payout-lookups.base';

export abstract class SettlementListsBase extends SettlementPayoutLookupsBase {
  async findSettlementsByIntegrationId(integrationId: string, from?: Date, to?: Date) {
    return this.settlements.findSettlementsByIntegrationId(integrationId, from, to);
  }

  async findSettlementsBySupplierMerchantId(merchantId: string) {
    return this.settlements.findSettlementsBySupplierMerchantId(merchantId);
  }
}
