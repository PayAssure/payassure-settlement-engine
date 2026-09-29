import { SettlementPaymentValidationBase } from './payment-validation.base';

export abstract class SettlementMerchantResolutionBase extends SettlementPaymentValidationBase {
  protected resolveSupplierMerchantId(settlement: any, supplierMerchantId?: string): string | null {
    if (supplierMerchantId) return String(supplierMerchantId);
    const metadataSupplierMerchantId = settlement?.metadata?.supplierMerchantId ?? null;
    if (metadataSupplierMerchantId) return String(metadataSupplierMerchantId);
    const paymentPayloadSuppliers = Array.isArray(settlement?.paymentPayload?.suppliers)
      ? settlement.paymentPayload.suppliers.filter((supplier: any) => supplier && typeof supplier === 'object')
      : [];
    if (paymentPayloadSuppliers.length === 0) return null;
    const firstSupplier = paymentPayloadSuppliers[0] as Record<string, any> | undefined;
    const fallbackSupplierMerchantId = firstSupplier?.supplierMerchantId ?? null;
    return fallbackSupplierMerchantId ? String(fallbackSupplierMerchantId) : null;
  }

  protected async resolveRetailerMerchantId(settlement: any): Promise<string | null> {
    const participantId = settlement?.businessId ?? null;
    if (participantId && typeof this.repository?.findIntegrationByParticipantId === 'function') {
      const activeRetailerIntegration = await this.repository.findIntegrationByParticipantId(String(participantId));
      if (activeRetailerIntegration?.merchantId) return String(activeRetailerIntegration.merchantId);
    }
    const metadataRetailerMerchantId = settlement?.metadata?.retailerMerchantId ?? null;
    if (metadataRetailerMerchantId) return String(metadataRetailerMerchantId);
    const paymentPayloadMerchantId = settlement?.paymentPayload?.merchantId ?? null;
    return paymentPayloadMerchantId ? String(paymentPayloadMerchantId) : null;
  }
}
