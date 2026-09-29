import { BadRequestException, NotFoundException } from '@nestjs/common';
import { SettlementMerchantResolutionBase } from './merchant-resolution.base';
import type { B2bPayoutRecipient } from './types';

export abstract class SettlementRecipientResolutionBase extends SettlementMerchantResolutionBase {
  protected async resolveB2bRecipient(settlement: any, party: 'SUPPLIER' | 'RETAILER', supplierMerchantId?: string): Promise<B2bPayoutRecipient> {
    if (party === 'RETAILER') {
      const retailerMerchantId = await this.resolveRetailerMerchantId(settlement);
      if (retailerMerchantId) {
        const retailerIntegration = await this.repository.findIntegrationByMerchantId(String(retailerMerchantId));
        if (retailerIntegration?.participant?.payment) {
          const payment = retailerIntegration.participant.payment as any;
          return {
            type: payment.type,
            provider: payment.provider ?? null,
            shortcode: payment.shortcode ?? null,
            accountNumber: payment.accountNumber ?? null,
            accountName: payment.accountName ?? null,
            phoneNumber: payment.phoneNumber ?? payment.payerPhoneNumber ?? null,
            payerPhoneNumber: payment.payerPhoneNumber ?? payment.phoneNumber ?? null,
          };
        }
      }
      const participant = await this.prisma.onboardingParticipant.findUnique({ where: { id: settlement.businessId } });
      if (!participant) {
        throw new NotFoundException({ statusCode: 404, message: 'Retailer participant not found for this settlement', error: 'RETAILER_NOT_FOUND' });
      }
      const payment = (participant.payment ?? null) as any;
      if (!payment) {
        throw new BadRequestException({ statusCode: 400, message: 'Retailer payout destination is not configured', error: 'RETAILER_PAYMENT_NOT_CONFIGURED' });
      }
      return {
        type: payment.type,
        provider: payment.provider ?? null,
        shortcode: payment.shortcode ?? null,
        accountNumber: payment.accountNumber ?? null,
        accountName: payment.accountName ?? null,
        phoneNumber: payment.phoneNumber ?? payment.payerPhoneNumber ?? null,
        payerPhoneNumber: payment.payerPhoneNumber ?? payment.phoneNumber ?? null,
      };
    }
    const supplierId = this.resolveSupplierMerchantId(settlement, supplierMerchantId);
    if (!supplierId) {
      throw new BadRequestException({ statusCode: 400, message: 'Supplier merchant ID is required for supplier payouts', error: 'SUPPLIER_MERCHANT_ID_REQUIRED' });
    }
    const payment = (settlement.paymentSnapshot ?? null) as any;
    if (payment && payment.type) {
      return {
        type: payment.type,
        provider: payment.provider ?? null,
        shortcode: payment.shortcode ?? null,
        accountNumber: payment.accountNumber ?? null,
        accountName: payment.accountName ?? null,
        phoneNumber: payment.phoneNumber ?? payment.payerPhoneNumber ?? null,
        payerPhoneNumber: payment.payerPhoneNumber ?? payment.phoneNumber ?? null,
      };
    }
    const supplierIntegration = await this.repository.findIntegrationByMerchantId(supplierId);
    if (!supplierIntegration?.participant) {
      throw new NotFoundException({ statusCode: 404, message: 'Supplier integration or payout destination not found', error: 'SUPPLIER_PAYMENT_NOT_FOUND' });
    }
    const supplierPayment = (supplierIntegration.participant.payment ?? null) as any;
    if (!supplierPayment) {
      throw new BadRequestException({ statusCode: 400, message: 'Supplier payout destination is not configured', error: 'SUPPLIER_PAYMENT_NOT_CONFIGURED' });
    }
    return {
      type: supplierPayment.type,
      provider: supplierPayment.provider ?? null,
      shortcode: supplierPayment.shortcode ?? null,
      accountNumber: supplierPayment.accountNumber ?? null,
      accountName: supplierPayment.accountName ?? null,
      phoneNumber: supplierPayment.phoneNumber ?? supplierPayment.payerPhoneNumber ?? null,
      payerPhoneNumber: supplierPayment.payerPhoneNumber ?? supplierPayment.phoneNumber ?? null,
    };
  }
}
