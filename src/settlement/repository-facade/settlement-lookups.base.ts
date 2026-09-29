import { SettlementWritesBase } from './settlement-writes.base';

export abstract class SettlementLookupsBase extends SettlementWritesBase {
  async findSettlementById(id: string) {
    return this.settlements.findSettlementById(id);
  }

  async findSettlementByBusinessAndPayloadReference(businessId: string, payloadMerchantTransactionReference: string) {
    return this.settlements.findSettlementByBusinessAndPayloadReference(businessId, payloadMerchantTransactionReference);
  }

  async findSettlementByReference(reference: string) {
    return this.settlements.findSettlementByReference(reference);
  }
}
