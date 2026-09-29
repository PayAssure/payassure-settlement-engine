import { BadRequestException, NotFoundException } from '@nestjs/common';
import { SettlementStatus } from '@prisma/client';
import { SettlementPaymentCallbackBase } from './payment-callback.base';

export abstract class SettlementAllocationBase extends SettlementPaymentCallbackBase {
  async splitAndAllocateFunds(data: any): Promise<any> {
    const timestamp = new Date().toISOString();
    const settlement = await this.repository.findSettlementByReference(data.merchantTransactionReference);
    if (!settlement) {
      this.logger.error('[SETTLEMENT][SPLIT] settlement not found', { timestamp, merchantTransactionReference: data.merchantTransactionReference });
      throw new NotFoundException({ statusCode: 404, message: 'Settlement not found for the provided merchant transaction reference', error: 'SETTLEMENT_NOT_FOUND' });
    }
    const paymentPayload = (settlement.paymentPayload && typeof settlement.paymentPayload === 'object' && !Array.isArray(settlement.paymentPayload))
      ? settlement.paymentPayload as Record<string, any>
      : null;
    if (!paymentPayload) {
      this.logger.error('[SETTLEMENT][SPLIT] payment payload not found', { timestamp, settlementId: settlement.id });
      throw new BadRequestException({ statusCode: 400, message: 'Settlement payment payload not found', error: 'INVALID_SETTLEMENT_PAYLOAD' });
    }
    const escrowTransfer = await this.prisma.retailerEscrowTransfer.findUnique({ where: { settlementId: settlement.id } });
    if (escrowTransfer) {
      if (['FAILED', 'BALANCE_MISMATCH'].includes(escrowTransfer.status)) {
        return {
          success: false,
          status: SettlementStatus.FAILED,
          message: escrowTransfer.failureReason ?? 'Retailer escrow funding failed; settlement allocation was blocked.',
        };
      }
      if (escrowTransfer.status !== 'SUCCEEDED') {
        return {
          success: true,
          status: SettlementStatus.PENDING_PROCESSING,
          message: 'Settlement allocation is waiting for retailer escrow balance verification and B2B transfer confirmation.',
          escrowTransferStatus: escrowTransfer.status,
        };
      }
      if (Number(escrowTransfer.mpesaAmount) > 0 && escrowTransfer.mpesaStatus !== 'SUCCESS') {
        return {
          success: true,
          status: SettlementStatus.PENDING_PROCESSING,
          message: 'Settlement allocation is waiting for the M-Pesa funding callback.',
          escrowTransferStatus: escrowTransfer.status,
          mpesaFundingStatus: escrowTransfer.mpesaStatus,
        };
      }
    }
    const suppliers = Array.isArray(paymentPayload.suppliers) ? paymentPayload.suppliers : [];
    if (suppliers.length === 0) {
      this.logger.warn('[SETTLEMENT][SPLIT] no suppliers found in payment payload', { timestamp, settlementId: settlement.id });
    }
    const supplierGroups = new Map<string, { merchantId: string; amount: number; retailerAmount: number; platformFee: number }>();
    let retailerAmount = 0;
    let platformFee = 0;
    for (const supplier of suppliers as Array<Record<string, any>>) {
      const items = Array.isArray(supplier.items) ? supplier.items : [];
      const supplierAmount = items.length > 0
        ? items.reduce((sum: number, item: any) => sum + Number(item.supplierAmount ?? 0), 0)
        : Number(supplier.supplierTotalAmount ?? 0);
      const supplierRetailerAmount = Number(supplier.retailerTotalAmount ?? 0);
      const supplierPlatformFee = Number(supplier.platformFee ?? 0);
      retailerAmount += supplierRetailerAmount;
      platformFee += supplierPlatformFee;
      const merchantId = String(supplier.supplierMerchantId ?? '').trim();
      if (!merchantId) continue;
      const existing = supplierGroups.get(merchantId);
      if (existing) {
        existing.amount += supplierAmount;
        existing.retailerAmount += supplierRetailerAmount;
        existing.platformFee += supplierPlatformFee;
      } else {
        supplierGroups.set(merchantId, { merchantId, amount: supplierAmount, retailerAmount: supplierRetailerAmount, platformFee: supplierPlatformFee });
      }
    }
    const supplierAllocations = Array.from(supplierGroups.values());
    const existingMetadata = (settlement.metadata && typeof settlement.metadata === 'object') ? settlement.metadata as Record<string, any> : {};
    const paymentCallbackRecord = {
      merchantTransactionReference: data.merchantTransactionReference,
      status: 'SUCCESS',
      provider: 'M-PESA',
      providerReference: data.mpesaReceipt ?? data.mpesaCheckoutRequestId ?? data.mpesaMerchantRequestId ?? null,
      amount: Number(settlement.amount ?? 0),
      currency: settlement.currency ?? 'KES',
      metadata: {
        mpesaReceipt: data.mpesaReceipt ?? null,
        mpesaCheckoutRequestId: data.mpesaCheckoutRequestId ?? null,
        mpesaMerchantRequestId: data.mpesaMerchantRequestId ?? null,
        resultCode: data.resultCode ?? null,
        resultDesc: data.resultDesc ?? null,
      },
      receivedAt: timestamp,
    };
    const resolvedRetailerMerchantId = await this.resolveRetailerMerchantId(settlement);
    const splitRecord = {
      timestamp,
      merchantTransactionReference: data.merchantTransactionReference,
      mpesaReceipt: data.mpesaReceipt ?? null,
      mpesaCheckoutRequestId: data.mpesaCheckoutRequestId ?? null,
      mpesaMerchantRequestId: data.mpesaMerchantRequestId ?? null,
      resultCode: data.resultCode ?? null,
      resultDesc: data.resultDesc ?? null,
      totalAmount: Number(settlement.amount),
      currency: settlement.currency ?? 'KES',
      allocations: {
        suppliers: supplierAllocations.map((supplier) => ({ merchantId: supplier.merchantId, amount: supplier.amount, status: 'PENDING_PAYOUT' })),
        retailer: { merchantId: resolvedRetailerMerchantId, amount: retailerAmount, status: 'PENDING_PAYOUT' },
      },
    };
    const splitRecords = Array.isArray(existingMetadata.splitRecords) ? existingMetadata.splitRecords : [];
    const updatedMetadata = {
      ...existingMetadata,
      paymentCallback: paymentCallbackRecord,
      paymentConfirmation: { ...paymentCallbackRecord, status: 'PAID', confirmedAt: timestamp },
      splitRecords: [...splitRecords, splitRecord],
      lastSplitAt: timestamp,
    };
    await this.repository.updateSettlementStatus(settlement.id, SettlementStatus.PROCESSING, { metadata: updatedMetadata });
    const dispatchResults = { suppliers: [] as any[], retailer: null as any, errors: [] as any[] };
    for (const supplier of supplierAllocations) {
      if (!supplier.merchantId || supplier.amount <= 0) continue;
      try {
        const supplierDispatch = await this.dispatchB2bPayouts({
          merchantTransactionReference: data.merchantTransactionReference,
          party: 'SUPPLIER',
          supplierMerchantId: supplier.merchantId,
          amount: supplier.amount,
        });
        dispatchResults.suppliers.push({ supplierMerchantId: supplier.merchantId, result: supplierDispatch });
      } catch (supplierError) {
        const errorMsg = supplierError instanceof Error ? supplierError.message : String(supplierError);
        this.logger.error('[SETTLEMENT][SPLIT] supplier payout dispatch failed', {
          timestamp,
          settlementId: settlement.id,
          supplierMerchantId: supplier.merchantId,
          error: errorMsg,
        });
        dispatchResults.errors.push({ party: 'SUPPLIER', supplierMerchantId: supplier.merchantId, amount: supplier.amount, error: errorMsg });
      }
    }
    if (retailerAmount > 0) {
      try {
        dispatchResults.retailer = await this.dispatchB2bPayouts({
          merchantTransactionReference: data.merchantTransactionReference,
          party: 'RETAILER',
          amount: retailerAmount,
        });
      } catch (retailerError) {
        const errorMsg = retailerError instanceof Error ? retailerError.message : String(retailerError);
        this.logger.error('[SETTLEMENT][SPLIT] retailer payout dispatch failed', { timestamp, settlementId: settlement.id, error: errorMsg });
        dispatchResults.errors.push({ party: 'RETAILER', amount: retailerAmount, error: errorMsg });
      }
    }
    const successfulPayoutCount = dispatchResults.suppliers.length + (dispatchResults.retailer ? 1 : 0);
    const failedPayoutCount = dispatchResults.errors.length;
    const payoutStatus = successfulPayoutCount === 0 && failedPayoutCount > 0
      ? 'FAILED'
      : failedPayoutCount > 0
        ? 'PARTIALLY_FAILED'
        : 'PROCESSING';
    return {
      success: payoutStatus === 'PROCESSING',
      status: payoutStatus,
      settlementId: settlement.id,
      merchantTransactionReference: data.merchantTransactionReference,
      splitRecord,
      dispatchResults,
      errors: dispatchResults.errors.length > 0 ? dispatchResults.errors : null,
    };
  }
}
