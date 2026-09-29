import { NotFoundException } from '@nestjs/common';
import type PaymentCallbackDto from '../dto/payment-callback.dto';
import { SettlementPaymentConfirmationBase } from './payment-confirmation.base';

export abstract class SettlementPaymentCallbackBase extends SettlementPaymentConfirmationBase {
  async handlePaymentCallback(data: PaymentCallbackDto): Promise<any> {
    const settlement = await this.repository.findSettlementByReference(data.merchantTransactionReference);
    if (!settlement) {
      throw new NotFoundException({ statusCode: 404, message: 'Settlement not found for the provided merchant transaction reference', error: 'SETTLEMENT_NOT_FOUND' });
    }
    const paymentCallback = {
      merchantTransactionReference: data.merchantTransactionReference,
      status: data.status ?? 'SUCCESS',
      provider: data.provider ?? null,
      providerReference: data.providerReference ?? null,
      amount: data.amount ?? null,
      currency: data.currency ?? null,
      metadata: data.metadata ?? {},
      receivedAt: new Date().toISOString(),
    };
    const existingMetadata = (settlement.metadata && typeof settlement.metadata === 'object') ? settlement.metadata as Record<string, any> : {};
    const paymentPayloadForAllocation = (settlement.paymentPayload && typeof settlement.paymentPayload === 'object' && !Array.isArray(settlement.paymentPayload))
      ? settlement.paymentPayload as Record<string, any>
      : {};
    const supplierGroups = new Map<string, number>();
    let retailerAmount = 0;
    let platformFee = 0;
    for (const supplier of (Array.isArray(paymentPayloadForAllocation.suppliers) ? paymentPayloadForAllocation.suppliers : [])) {
      const supplierId = String(supplier.supplierMerchantId ?? '').trim();
      const supplierAmount = Number(supplier.supplierTotalAmount ?? 0);
      if (supplierId) supplierGroups.set(supplierId, (supplierGroups.get(supplierId) ?? 0) + supplierAmount);
      retailerAmount += Number(supplier.retailerTotalAmount ?? 0);
      platformFee += Number(supplier.platformFee ?? 0);
    }
    const supplierAllocations = Array.from(supplierGroups, ([merchantId, amount]) => ({ merchantId, amount }));
    const supplierAmount = supplierAllocations.reduce((total, supplier) => total + supplier.amount, 0);
    const paymentMethod = (settlement.paymentPayload && typeof settlement.paymentPayload === 'object' && !Array.isArray(settlement.paymentPayload)
      ? (settlement.paymentPayload as Record<string, any>).paymentMethod
      : null) as Record<string, any> | null;
    const supplierMerchantId = supplierAllocations[0]?.merchantId ?? this.resolveSupplierMerchantId(settlement);
    const retailerMerchantId = await this.resolveRetailerMerchantId(settlement);
    const supplierRecipient = supplierMerchantId ? await this.resolveB2bRecipient(settlement, 'SUPPLIER', supplierMerchantId) : null;
    const retailerRecipient = retailerMerchantId ? await this.resolveB2bRecipient(settlement, 'RETAILER', retailerMerchantId) : null;
    const allocationPlan = {
      customerReceived: Number(settlement.amount),
      ledgerEntries: [
        { account: 'Cash', direction: 'DEBIT', amount: Number(settlement.amount), description: 'Customer payment received' },
        { account: 'Customer Clearing', direction: 'CREDIT', amount: Number(settlement.amount), description: 'Customer funds parked pending allocation' },
      ],
      allocations: [
        { party: 'Supplier', amount: supplierAmount, destination: 'B2B payout', status: 'PENDING' },
        { party: 'Retailer', amount: retailerAmount, destination: 'B2B payout', status: 'PENDING' },
        { party: 'Platform', amount: platformFee, destination: 'Retained fee', status: 'PENDING' },
      ],
      paymentDetails: {
        supplier: {
          type: supplierRecipient?.type ?? paymentMethod?.type ?? 'MPESA',
          provider: supplierRecipient?.provider ?? paymentMethod?.provider ?? 'Safaricom',
          shortcode: supplierRecipient?.shortcode ?? null,
          accountName: supplierRecipient?.accountName ?? null,
          phoneNumber: supplierRecipient?.phoneNumber ?? supplierRecipient?.payerPhoneNumber ?? null,
          payerPhoneNumber: supplierRecipient?.payerPhoneNumber ?? supplierRecipient?.phoneNumber ?? null,
        },
        retailer: {
          type: retailerRecipient?.type ?? paymentMethod?.type ?? 'MPESA',
          provider: retailerRecipient?.provider ?? paymentMethod?.provider ?? 'Safaricom',
          shortcode: retailerRecipient?.shortcode ?? null,
          accountName: retailerRecipient?.accountName ?? null,
          phoneNumber: retailerRecipient?.phoneNumber ?? retailerRecipient?.payerPhoneNumber ?? null,
          payerPhoneNumber: retailerRecipient?.payerPhoneNumber ?? retailerRecipient?.phoneNumber ?? null,
        },
      },
    };
    await this.repository.updateSettlementStatus(settlement.id, 'PENDING_PROCESSING', {
      metadata: {
        ...existingMetadata,
        paymentCallback,
        paymentConfirmation: { ...paymentCallback, status: 'PAID', confirmedAt: new Date().toISOString() },
        allocationPlan,
      },
    });
    return {
      success: true,
      status: 'PENDING_PROCESSING',
      message: 'Payment callback received. The settlement is now moving into ledger allocation and payout processing.',
      settlementId: settlement.id,
      nextStep: 'Create ledger entries and split the customer funds into supplier, retailer, and platform allocations.',
      allocationPlan,
    };
  }
}
