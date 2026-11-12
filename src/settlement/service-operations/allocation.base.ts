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
    const existingMetadata = (settlement.metadata && typeof settlement.metadata === 'object') ? settlement.metadata as Record<string, any> : {};
    const settlementPlan = existingMetadata.settlementPlan && typeof existingMetadata.settlementPlan === 'object'
      ? existingMetadata.settlementPlan as Record<string, any>
      : null;
    const storedSuppliers = Array.isArray(paymentPayload.suppliers) ? paymentPayload.suppliers : [];
    const resolvedMode = String(
      settlementPlan?.settlementMode
        ?? existingMetadata.resolvedSettlementMode
        ?? (storedSuppliers.length > 0 && storedSuppliers.every((supplier: any) => !supplier?.supplierMerchantId) ? 'DIRECT' : ''),
    ).toUpperCase();
    const resolvedPaymentMethod = String(
      settlementPlan?.paymentMethod
        ?? existingMetadata.fundingPlan?.paymentMethod
        ?? paymentPayload.paymentMethod?.type
        ?? '',
    ).toUpperCase();
    if (resolvedMode === 'DIRECT' && resolvedPaymentMethod === 'CASH') {
      this.logger.log('[DIRECT_SETTLEMENT][PAYOUTS_SKIPPED]', {
        settlementId: settlement.id,
        merchantTransactionReference: data.merchantTransactionReference,
        settlementMode: resolvedMode,
        paymentMethod: resolvedPaymentMethod,
        retailerPayoutAmount: 0,
        supplierPayoutAmount: 0,
        escrowTransferLookup: 'SKIPPED',
        reason: 'Cash has already been received by the retailer',
      });
      if (settlement.status !== SettlementStatus.COMPLETED) {
        await this.repository.updateSettlementStatus(settlement.id, SettlementStatus.COMPLETED, {
          completedAt: new Date(),
          metadata: {
            ...existingMetadata,
            settlementPlan: { ...(settlementPlan ?? {}), settlementMode: resolvedMode, paymentMethod: resolvedPaymentMethod, settlementStatus: 'SETTLED' },
          },
        });
      }
      return {
        success: true,
        status: 'SETTLED',
        settlementId: settlement.id,
        merchantTransactionReference: data.merchantTransactionReference,
        settlementPlan: { ...(settlementPlan ?? {}), settlementMode: resolvedMode, paymentMethod: resolvedPaymentMethod, settlementStatus: 'SETTLED' },
        dispatchResults: { suppliers: [], retailer: null, errors: [] },
        message: 'Direct cash settlement is settled; no escrow or payout workflow was entered.',
      };
    }

    const fundingPlan = existingMetadata.fundingPlan && typeof existingMetadata.fundingPlan === 'object'
      ? existingMetadata.fundingPlan as Record<string, any>
      : {};
    const escrowFunding = existingMetadata.escrowFunding && typeof existingMetadata.escrowFunding === 'object'
      ? existingMetadata.escrowFunding as Record<string, any>
      : {};
    const directCentralPayout = escrowFunding.payoutSource === 'CENTRAL_ACCOUNT';
    if (data.customerMpesaPaymentConfirmed === true && Number(fundingPlan.mpesaAmount ?? 0) > 0) {
      fundingPlan.mpesaStatus = 'SUCCESS';
      existingMetadata.fundingPlan = fundingPlan;
      await this.repository.updateSettlementStatus(settlement.id, SettlementStatus.PENDING_PROCESSING, {
        metadata: existingMetadata,
      });
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
      if (escrowTransfer.status !== 'SUCCEEDED' && !(directCentralPayout && escrowTransfer.status === 'BALANCE_VERIFIED')) {
        return {
          success: true,
          status: SettlementStatus.PENDING_PROCESSING,
          message: 'Settlement allocation is waiting for retailer escrow balance verification and transfer confirmation.',
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
    if (
      Number(fundingPlan.cashAmount ?? 0) > 0
      && Number(fundingPlan.mpesaAmount ?? 0) > 0
      && fundingPlan.mpesaStatus !== 'SUCCESS'
    ) {
      return {
        success: true,
        status: SettlementStatus.PENDING_PROCESSING,
        message: 'Settlement allocation is waiting for the customer M-Pesa payment callback.',
        mpesaFundingStatus: fundingPlan.mpesaStatus ?? 'WAITING_FOR_CUSTOMER',
      };
    }
    const suppliers = Array.isArray(settlementPlan?.allocations)
      ? settlementPlan.allocations
      : Array.isArray(paymentPayload.suppliers)
        ? paymentPayload.suppliers
        : [];
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
    const plannedPayoutInstructions = Array.isArray(settlementPlan?.payoutInstructions)
      ? settlementPlan.payoutInstructions as Array<Record<string, any>>
      : null;
    let remainingSupplierPayout = settlementPlan
      ? Math.max(0, Number(settlementPlan.supplierPayoutAmount ?? 0))
      : Number.POSITIVE_INFINITY;
    let remainingEscrowFunding = settlementPlan
      ? Math.max(0, Number(settlementPlan.escrowDebitAmount ?? 0))
      : 0;
    const approvedSupplierAllocations = plannedPayoutInstructions
      ? plannedPayoutInstructions
        .filter((instruction) => instruction.party === 'SUPPLIER' && Number(instruction.amount) > 0)
        .map((instruction) => ({
          merchantId: String(instruction.supplierMerchantId),
          amount: Number(instruction.amount),
          escrowFundedAmount: Number(instruction.escrowFundedAmount ?? 0),
        }))
      : supplierAllocations
        .map((supplier) => {
          const amount = Math.min(supplier.amount, remainingSupplierPayout);
          const escrowFundedAmount = Math.min(amount, remainingEscrowFunding);
          remainingSupplierPayout -= amount;
          remainingEscrowFunding -= escrowFundedAmount;
          return { ...supplier, amount, escrowFundedAmount };
        })
        .filter((supplier) => supplier.amount > 0);
    let approvedRetailerPayout = plannedPayoutInstructions
      ? Math.max(0, Number(plannedPayoutInstructions.find((instruction) => instruction.party === 'RETAILER')?.amount ?? 0))
      : settlementPlan
        ? Math.max(0, Number(settlementPlan.retailerPayoutAmount ?? 0))
        : retailerAmount;
    if (settlementPlan?.settlementMode === 'DIRECT' && Number(settlementPlan.mpesaAmount ?? 0) > 0) {
      const confirmedMpesaAmount = data.customerMpesaPaymentConfirmed === true
        ? Number(fundingPlan.mpesaAmount ?? settlementPlan.mpesaAmount)
        : 0;
      approvedRetailerPayout = Math.min(
        approvedRetailerPayout,
        confirmedMpesaAmount,
        Math.max(0, retailerAmount),
      );
      settlementPlan.confirmedMpesaAmount = confirmedMpesaAmount;
      settlementPlan.retailerPayoutAmount = approvedRetailerPayout;
      settlementPlan.retailerPayoutRequired = approvedRetailerPayout > 0;
      if (plannedPayoutInstructions) {
        settlementPlan.payoutInstructions = plannedPayoutInstructions
          .filter((instruction) => instruction.party !== 'RETAILER')
          .concat(approvedRetailerPayout > 0 ? [{
            party: 'RETAILER',
            amount: approvedRetailerPayout,
            escrowFundedAmount: 0,
          }] : []);
      }
    }

    const paymentCallbackRecord = {
      merchantTransactionReference: data.merchantTransactionReference,
      status: 'SUCCESS',
      provider: Number(fundingPlan.mpesaAmount ?? 0) > 0 ? 'M-PESA' : 'RETAILER_ESCROW_LEDGER',
      providerReference: data.mpesaReceipt ?? data.mpesaCheckoutRequestId ?? data.mpesaMerchantRequestId ?? escrowFunding.transferId ?? null,
      amount: Number(settlement.amount ?? 0),
      currency: settlement.currency ?? 'KES',
      metadata: {
        mpesaReceipt: data.mpesaReceipt ?? null,
        mpesaCheckoutRequestId: data.mpesaCheckoutRequestId ?? null,
        mpesaMerchantRequestId: data.mpesaMerchantRequestId ?? null,
        resultCode: data.resultCode ?? null,
        resultDesc: data.resultDesc ?? null,
        ...(directCentralPayout ? { payoutSource: 'CENTRAL_ACCOUNT', escrowTransferId: escrowFunding.transferId ?? null } : {}),
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
      expectedPayoutCount: approvedSupplierAllocations.length + (approvedRetailerPayout > 0 ? 1 : 0),
      allocations: {
        suppliers: approvedSupplierAllocations.map((supplier) => ({ merchantId: supplier.merchantId, amount: supplier.amount, status: 'PENDING_PAYOUT' })),
        retailer: { merchantId: resolvedRetailerMerchantId, amount: approvedRetailerPayout, status: approvedRetailerPayout > 0 ? 'PENDING_PAYOUT' : 'NOT_REQUIRED' },
      },
    };
    const splitRecords = Array.isArray(existingMetadata.splitRecords) ? existingMetadata.splitRecords : [];
    const updatedMetadata = {
      ...existingMetadata,
      paymentCallback: paymentCallbackRecord,
      paymentConfirmation: { ...paymentCallbackRecord, status: 'PAID', confirmedAt: timestamp },
      ...(settlementPlan ? { settlementPlan } : {}),
      splitRecords: [...splitRecords, splitRecord],
      lastSplitAt: timestamp,
    };
    await this.repository.updateSettlementStatus(settlement.id, SettlementStatus.PROCESSING, { metadata: updatedMetadata });
    await this.repository.notifyWebhookEvent?.(settlement.id, 'payment.collection.succeeded', {
      status: 'PAID',
      provider: paymentCallbackRecord.provider,
      provider_reference: paymentCallbackRecord.providerReference,
      amount: paymentCallbackRecord.amount,
      currency: paymentCallbackRecord.currency,
    });
    await this.repository.notifyWebhookEvent?.(settlement.id, 'payment.settlement.started');
    const dispatchResults = { suppliers: [] as any[], retailer: null as any, errors: [] as any[] };
    for (const supplier of approvedSupplierAllocations) {
      if (!supplier.merchantId || supplier.amount <= 0) continue;
      try {
        const supplierDispatch = await this.dispatchB2bPayouts({
          merchantTransactionReference: data.merchantTransactionReference,
          party: 'SUPPLIER',
          supplierMerchantId: supplier.merchantId,
          amount: supplier.amount,
          escrowFundedAmount: supplier.escrowFundedAmount,
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
    if (approvedRetailerPayout > 0) {
      try {
        dispatchResults.retailer = await this.dispatchB2bPayouts({
          merchantTransactionReference: data.merchantTransactionReference,
          party: 'RETAILER',
          amount: approvedRetailerPayout,
        });
      } catch (retailerError) {
        const errorMsg = retailerError instanceof Error ? retailerError.message : String(retailerError);
        this.logger.error('[SETTLEMENT][SPLIT] retailer payout dispatch failed', { timestamp, settlementId: settlement.id, error: errorMsg });
        dispatchResults.errors.push({ party: 'RETAILER', amount: approvedRetailerPayout, error: errorMsg });
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
