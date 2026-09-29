import { SettlementServiceContextBase } from './service-context.base';

export abstract class SettlementPaymentValidationBase extends SettlementServiceContextBase {
  protected hasConfirmedCustomerPayment(settlement: any, metadata: Record<string, any>): boolean {
    const settlementStatus = String(settlement?.status ?? '').toUpperCase();
    const callbackStatus = String(metadata?.paymentCallback?.status ?? metadata?.paymentConfirmation?.status ?? '').toUpperCase();
    const confirmationStatus = String(metadata?.paymentConfirmation?.status ?? '').toUpperCase();
    const splitStatus = Array.isArray(metadata?.splitRecords)
      ? metadata.splitRecords.some((record: any) => {
          const sameReference = record?.merchantTransactionReference === settlement?.merchantTransactionReference;
          const successStatus = ['SUCCESS', 'PAID', 'COMPLETED'].includes(String(record?.status ?? '').toUpperCase());
          return sameReference && successStatus;
        })
      : false;
    const processingState = ['PENDING_PROCESSING', 'PROCESSING', 'PROCESSING_COMPLETE', 'AWAITING_RECONCILIATION', 'COMPLETED'].includes(settlementStatus);
    const callbackConfirmed = ['SUCCESS', 'PAID', 'COMPLETED'].includes(callbackStatus);
    const confirmationConfirmed = ['SUCCESS', 'PAID', 'COMPLETED'].includes(confirmationStatus);
    return callbackConfirmed || confirmationConfirmed || splitStatus || processingState;
  }

  protected async resolvePayoutValidationSettlement(settlement: any): Promise<any> {
    if (!settlement) return settlement;
    const metadata = (settlement.metadata && typeof settlement.metadata === 'object') ? settlement.metadata as Record<string, any> : {};
    if (this.hasConfirmedCustomerPayment(settlement, metadata)) return settlement;
    const parentSettlementId = metadata.parentSettlementId ?? null;
    if (parentSettlementId && typeof this.repository.findSettlementById === 'function') {
      const parentSettlement = await this.repository.findSettlementById(String(parentSettlementId));
      if (parentSettlement && parentSettlement.id !== settlement.id) {
        const parentMetadata = (parentSettlement.metadata && typeof parentSettlement.metadata === 'object') ? parentSettlement.metadata as Record<string, any> : {};
        if (this.hasConfirmedCustomerPayment(parentSettlement, parentMetadata)) return parentSettlement;
      }
    }
    const originalReference = metadata.originalMerchantReference ?? metadata.parentMerchantTransactionReference ?? null;
    if (originalReference && typeof this.repository.findSettlementByReference === 'function') {
      const originalSettlement = await this.repository.findSettlementByReference(String(originalReference));
      if (originalSettlement && originalSettlement.id !== settlement.id) {
        const originalMetadata = (originalSettlement.metadata && typeof originalSettlement.metadata === 'object') ? originalSettlement.metadata as Record<string, any> : {};
        if (this.hasConfirmedCustomerPayment(originalSettlement, originalMetadata)) return originalSettlement;
      }
    }
    return settlement;
  }
}
