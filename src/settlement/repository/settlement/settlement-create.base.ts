import { Prisma, SettlementStatus } from '@prisma/client';
import { InitiateSettlementDto } from '../../dto/initiate-settlement.dto';
import { SettlementRecordContextBase } from './record-context.base';

export abstract class SettlementCreateBase extends SettlementRecordContextBase {
  async createSettlement(businessId: string, integrationId: string, payAssureReference: string, internalMerchantTransactionReference: string, data: InitiateSettlementDto) {
    const paymentMethod = {
      type: data.paymentMethod.type,
      payerPhoneNumber: String(data.paymentMethod.payerPhoneNumber ?? '').trim() || undefined,
      provider: data.paymentMethod.provider ?? undefined,
    };
    const paymentPayload = {
      merchantTransactionReference: data.merchantTransactionReference,
      merchantId: data.merchantId ?? undefined,
      totalAmount: data.totalAmount,
      currency: data.currency,
      settlementMethod: data.settlementMethod,
      description: data.description ?? undefined,
      payment: data.payment ?? undefined,
      paymentMethod,
      callbackUrl: data.callbackUrl ?? undefined,
      transactionDate: data.transactionDate,
      items: data.items ?? undefined,
      suppliers: data.suppliers.map((supplier) => ({
        supplierMerchantId: supplier.supplierMerchantId,
        supplierTotalAmount: supplier.supplierTotalAmount ?? undefined,
        retailerTotalAmount: supplier.retailerTotalAmount ?? undefined,
        platformFee: supplier.platformFee ?? undefined,
        items: (supplier.items ?? []).map((item) => ({
          itemId: item.itemId ?? item.itemReference ?? undefined,
          supplierAmount: item.supplierAmount ?? undefined,
          retailerAmount: item.retailerAmount ?? undefined,
        })),
      })),
      metadata: data.metadata ?? undefined,
    };
    return this.prisma.settlement.create({
      data: {
        businessId,
        integrationId,
        amount: data.totalAmount,
        currency: data.currency,
        settlementMethod: data.settlementMethod,
        reference: payAssureReference,
        merchantTransactionReference: internalMerchantTransactionReference,
        description: data.description ?? undefined,
        metadata: {
          originalMerchantReference: data.merchantTransactionReference,
          retailerMerchantId: data.merchantId ?? undefined,
          ...data.metadata,
        },
        paymentPayload,
        status: SettlementStatus.INITIATED,
      } as Prisma.SettlementCreateInput,
    });
  }

  async createSupplierSettlement(businessId: string, integrationId: string, data: { amount: number; currency: string; settlementMethod: string; reference: string; merchantTransactionReference: string; description?: string; metadata?: Record<string, any>; paymentSnapshot?: any; paymentPayload?: Record<string, any>; }) {
    return this.prisma.settlement.create({ data: { businessId, integrationId, amount: data.amount, currency: data.currency, settlementMethod: data.settlementMethod, reference: data.reference, merchantTransactionReference: data.merchantTransactionReference, description: data.description, metadata: data.metadata, paymentPayload: data.paymentPayload ?? undefined, paymentSnapshot: data.paymentSnapshot ?? undefined, status: SettlementStatus.INITIATED } as Prisma.SettlementCreateInput });
  }
}
