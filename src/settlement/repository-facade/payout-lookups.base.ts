import { SettlementLookupsBase } from './settlement-lookups.base';

export abstract class SettlementPayoutLookupsBase extends SettlementLookupsBase {
  async findSettlementByPayoutCallbackIdentifier(callbackIdentifier: string) {
    return this.settlements.findSettlementByPayoutCallbackIdentifier(callbackIdentifier);
  }

  async findSettlementsByBusinessId(businessId: string, skip = 0, take = 10) {
    return this.settlements.findSettlementsByBusinessId(businessId, skip, take);
  }
}
