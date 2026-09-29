import { BadRequestException, NotFoundException } from '@nestjs/common';
import type PaymentConfirmationDto from '../dto/payment-confirmation.dto';
import { SettlementPayoutCallbackBase } from './payout-callback.base';

export abstract class SettlementPaymentConfirmationBase extends SettlementPayoutCallbackBase {
  async confirmSettlementPayment(data: PaymentConfirmationDto): Promise<any> {
    let settlement = await this.repository.findSettlementById(data.settlementId);
    if (!settlement) {
      const fallbackSettlement = await this.repository.findSettlementByReference?.(data.settlementId);
      settlement = fallbackSettlement ?? null;
    }
    if (!settlement) {
      this.logger.warn(`[CONFIRMATION][LOOKUP] failed: settlement ${data.settlementId} was not found`);
      throw new NotFoundException({ statusCode: 404, message: 'Settlement not found for the provided settlement identifier', error: 'SETTLEMENT_NOT_FOUND' });
    }
    if ((settlement.status as string) === 'PENDING_PROCESSING' || (settlement.status as string) === 'PROCESSING' || (settlement.status as string) === 'COMPLETED') {
      return {
        success: true,
        status: settlement.status,
        message: 'Payment confirmation was already processed for this settlement.',
        settlementId: settlement.id,
      };
    }
    if (data.status && data.status.toUpperCase() !== 'PAID') {
      this.logger.warn(`[CONFIRMATION][RESULT] unsupported status ${data.status} for settlement ${settlement.id}`);
      throw new BadRequestException({ statusCode: 400, message: 'Only PAID confirmations are accepted for settlement completion', error: 'INVALID_PAYMENT_STATUS' });
    }
    const paymentConfirmation = {
      paymentId: data.paymentId ?? null,
      settlementId: data.settlementId,
      status: data.status ?? 'PAID',
      provider: data.provider ?? null,
      paidAmount: data.paidAmount ?? Number(settlement.amount ?? 0),
      paidAt: data.paidAt ?? new Date().toISOString(),
      providerReference: data.providerReference ?? null,
      confirmedAt: new Date().toISOString(),
    };
    const existingMetadata = (settlement.metadata && typeof settlement.metadata === 'object') ? settlement.metadata as Record<string, any> : {};
    const allocationPayload = (settlement.paymentPayload && typeof settlement.paymentPayload === 'object' && !Array.isArray(settlement.paymentPayload))
      ? settlement.paymentPayload as Record<string, any>
      : {};
    const supplierGroups = new Map<string, number>();
    let retailerAmount = 0;
    let platformFee = 0;
    for (const supplier of (Array.isArray(allocationPayload.suppliers) ? allocationPayload.suppliers : [])) {
      const supplierId = String(supplier.supplierMerchantId ?? '').trim();
      if (supplierId) supplierGroups.set(supplierId, (supplierGroups.get(supplierId) ?? 0) + Number(supplier.supplierTotalAmount ?? 0));
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
      metadata: { ...existingMetadata, paymentConfirmation, allocationPlan },
    });
    const dispatchResults: Array<any> = [];
    try {
      for (const supplier of supplierAllocations) {
        try {
          const supplierDispatch = await this.dispatchB2bPayouts({
            merchantTransactionReference: settlement.merchantTransactionReference,
            party: 'SUPPLIER',
            amount: supplier.amount,
            supplierMerchantId: supplier.merchantId,
          });
          dispatchResults.push({ party: 'SUPPLIER', supplierMerchantId: supplier.merchantId, result: supplierDispatch });
        } catch (error) {
          this.logger.warn(`[CONFIRMATION][DISPATCH] supplier payout dispatch failed for settlement ${settlement.id}: ${error instanceof Error ? error.message : String(error)}`);
          dispatchResults.push({ party: 'SUPPLIER', supplierMerchantId: supplier.merchantId, error: error instanceof Error ? error.message : String(error) });
        }
      }
    } catch (error) {
      this.logger.error(`[CONFIRMATION][DISPATCH] supplier payout dispatch loop failed for settlement ${settlement.id}: ${error instanceof Error ? error.message : String(error)}`);
    }
    try {
      const retailerDispatch = await this.dispatchB2bPayouts({
        merchantTransactionReference: settlement.merchantTransactionReference,
        party: 'RETAILER',
        amount: retailerAmount,
      });
      dispatchResults.push({ party: 'RETAILER', result: retailerDispatch });
    } catch (error) {
      this.logger.warn(`[CONFIRMATION][DISPATCH] retailer payout dispatch failed for settlement ${settlement.id}: ${error instanceof Error ? error.message : String(error)}`);
      dispatchResults.push({ party: 'RETAILER', error: error instanceof Error ? error.message : String(error) });
    }
    return {
      success: true,
      status: 'PENDING_PROCESSING',
      message: 'Payment confirmation accepted. The settlement is now processing B2B payout dispatch.',
      settlementId: settlement.id,
      nextStep: 'Dispatch B2B payouts to supplier and retailer and wait for payout callbacks.',
      allocationPlan,
      dispatchResults,
    };
  }
}
