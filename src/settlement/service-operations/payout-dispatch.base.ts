import { BadRequestException, NotFoundException } from '@nestjs/common';
import { SettlementGatewayRequestBase } from './gateway-request.base';
import type { B2bGatewayResponse } from './types';

export abstract class SettlementPayoutDispatchBase extends SettlementGatewayRequestBase {
  async dispatchB2bPayouts(data: any): Promise<any> {
    const settlement = await this.repository.findSettlementByReference(data.merchantTransactionReference);
    if (!settlement) {
      throw new NotFoundException({ statusCode: 404, message: 'Settlement not found for the provided merchant transaction reference', error: 'SETTLEMENT_NOT_FOUND' });
    }
    const existingMetadata = (settlement.metadata && typeof settlement.metadata === 'object') ? settlement.metadata as Record<string, any> : {};
    const validationSettlement = await this.resolvePayoutValidationSettlement(settlement);
    const validationMetadata = (validationSettlement?.metadata && typeof validationSettlement.metadata === 'object')
      ? validationSettlement.metadata as Record<string, any>
      : {};
    const settlementStatus = String((validationSettlement?.status ?? settlement?.status ?? '')).toUpperCase();
    const hasConfirmedCustomerPayment = this.hasConfirmedCustomerPayment(validationSettlement, validationMetadata);
    if (!hasConfirmedCustomerPayment) {
      this.logger.warn('[B2B][DISPATCH] payment confirmation gate failed', {
        settlementId: settlement.id,
        settlementLookupId: validationSettlement?.id ?? settlement.id,
        merchantTransactionReference: settlement.merchantTransactionReference,
        validationReference: validationSettlement?.merchantTransactionReference ?? null,
        settlementStatus,
        metadata: validationMetadata,
      });
      throw new NotFoundException({
        statusCode: 404,
        message: 'A successful payment callback or confirmation has not been recorded for this settlement',
        data: { existingMetadata, settlementStatus },
        error: 'PAYMENT_NOT_CONFIRMED',
      });
    }

    const workingSettlement = validationSettlement ?? settlement;
    const party = (String(data.party || (existingMetadata?.supplierMerchantId ? 'SUPPLIER' : 'RETAILER')).toUpperCase() as 'SUPPLIER' | 'RETAILER');
    const resolvedSupplierMerchantId = this.resolveSupplierMerchantId(workingSettlement, data.supplierMerchantId);
    const resolvedRetailerMerchantId = await this.resolveRetailerMerchantId(workingSettlement);
    const resolvedPartyMerchantId = party === 'RETAILER' ? resolvedRetailerMerchantId : resolvedSupplierMerchantId;
    const recipient = await this.resolveB2bRecipient(workingSettlement, party, resolvedSupplierMerchantId ?? undefined);

    if (recipient.type === 'BANK' && (!recipient.shortcode || !recipient.accountNumber)) {
      throw new BadRequestException({ statusCode: 400, message: 'Bank payouts require a recipient shortcode and accountNumber', error: 'BANK_PAYOUT_DETAILS_INCOMPLETE' });
    }
    if (recipient.type === 'MPESA') {
      const recipientPhoneNumber = recipient.phoneNumber ?? recipient.payerPhoneNumber ?? null;
      if (!recipientPhoneNumber) {
        throw new BadRequestException({ statusCode: 400, message: 'MPESA payouts require a recipient phoneNumber', error: 'MPESA_PAYOUT_DETAILS_INCOMPLETE' });
      }
    }

    let amount = Number(data.amount ?? 0);
    if (amount <= 0) {
      const allocation = Array.isArray(existingMetadata.allocationPlan?.allocations)
        ? existingMetadata.allocationPlan.allocations.find((alloc: any) => alloc.party === party)
        : null;
      amount = Number(allocation?.amount ?? 0);
    }
    if (amount <= 0) {
      throw new BadRequestException({ statusCode: 400, message: 'Payout amount must be greater than zero', error: 'INVALID_PAYOUT_AMOUNT' });
    }
    const roundedAmount = amount > 0 && amount < 1 ? 1 : Math.round(amount);

    const payoutAttemptResult = await this.idempotencyService.createOrGetPayoutAttempt({
      settlementId: settlement.id,
      merchantTransactionReference: data.merchantTransactionReference,
      party,
      amount: roundedAmount,
      recipientMerchantId: resolvedPartyMerchantId ?? undefined,
      recipientType: recipient.type,
      recipientPhone: recipient.phoneNumber ?? recipient.payerPhoneNumber ?? undefined,
    });
    if (!payoutAttemptResult.isNewAttempt && payoutAttemptResult.status === 'COMPLETED') {
      this.logger.warn('[PAYOUT] Payout already completed, skipping duplicate', {
        settlementId: settlement.id,
        payoutReference: payoutAttemptResult.payoutReference,
        party,
        attemptCount: payoutAttemptResult.attemptCount,
      });
      return {
        success: true,
        status: 'COMPLETED',
        payoutReference: payoutAttemptResult.payoutReference,
        isDuplicate: true,
        message: 'Payout already completed. Duplicate dispatch prevented.',
        dispatchRecord: {
          reference: payoutAttemptResult.payoutReference,
          party,
          status: 'COMPLETED',
          amount: roundedAmount,
          attemptCount: payoutAttemptResult.attemptCount,
        },
      };
    }

    const payoutReference = payoutAttemptResult.payoutReference;
    const callbackIdentifier = (globalThis as any)?.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(16).slice(2)}`;
    const callbackUrl = this.getB2bPayoutCallbackUrl(callbackIdentifier);
    const recipientPhoneNumber = recipient.phoneNumber ?? recipient.payerPhoneNumber ?? null;
    const recipientShortCode = recipient.shortcode ?? recipientPhoneNumber ?? null;
    const payoutPayment = {
      type: recipient.type,
      provider: recipient.provider ?? null,
      shortcode: recipient.shortcode ?? null,
      accountNumber: recipient.accountNumber ?? null,
      accountName: recipient.accountName ?? null,
      phoneNumber: recipientPhoneNumber,
      payerPhoneNumber: recipientPhoneNumber,
    };
    const requestPayload = {
      reference: payoutReference,
      merchantTransactionReference: workingSettlement.merchantTransactionReference,
      settlementReference: workingSettlement.reference,
      party,
      amount: roundedAmount,
      currency: workingSettlement.currency ?? 'KES',
      recipientShortCode,
      accountReference: recipient.accountNumber,
      remarks: `B2B payout to ${party}`,
      description: `Settlement payout for ${party}`,
      callbackUrl: callbackUrl ?? undefined,
      recipientType: recipient.type,
      recipientProvider: recipient.provider,
      recipientPhoneNumber: recipientPhoneNumber ?? undefined,
      metadata: {
        settlementId: settlement.id,
        party,
        callbackIdentifier,
        callbackToken: callbackIdentifier,
        callbackUrl: callbackUrl ?? null,
        supplierMerchantId: party === 'SUPPLIER' ? (resolvedSupplierMerchantId ?? null) : null,
        retailerMerchantId: party === 'RETAILER' ? (resolvedRetailerMerchantId ?? null) : null,
        merchantId: resolvedPartyMerchantId ?? null,
        payment: payoutPayment,
        ...((data.metadata ?? {}) as Record<string, any>),
      },
    };

    this.logger.log('[PAYOUT_DISPATCH_PAYLOAD]', {
      ...requestPayload,
      idempotencyKey: payoutAttemptResult.idempotencyKey,
      isNewAttempt: payoutAttemptResult.isNewAttempt,
      attemptCount: payoutAttemptResult.attemptCount,
    });
    if (recipient.type === 'BANK') {
      this.logger.log('[B2B][BANK_PAYOUT] dispatching bank payout through M-Pesa B2B', {
        settlementId: settlement.id,
        party,
        amount: roundedAmount,
        recipientShortCode,
        accountReference: recipient.accountNumber,
        accountName: recipient.accountName,
        merchantTransactionReference: workingSettlement.merchantTransactionReference,
      });
    }

    let gatewayResult: B2bGatewayResponse;
    try {
      gatewayResult = await this.sendB2bGatewayPayoutRequest(requestPayload);
      await this.idempotencyService.updatePayoutAttemptStatus(
        payoutAttemptResult.idempotencyKey,
        gatewayResult.success ? 'SUBMITTED' : 'FAILED',
        {
          responseCode: gatewayResult.responseCode,
          responseDescription: gatewayResult.responseDescription,
          response: gatewayResult.response,
        },
      );
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      if (payoutAttemptResult.isNewAttempt) {
        const retrySchedule = await this.retryService.scheduleFailedPayoutForRetry(payoutAttemptResult.idempotencyKey, errorMsg);
        this.logger.error('[PAYOUT] Payout dispatch failed, scheduled for retry', {
          payoutReference,
          settlementId: settlement.id,
          error: errorMsg,
          retrySchedule,
        });
      }
      throw error;
    }

    const payoutDispatches = Array.isArray(existingMetadata.payoutDispatches) ? existingMetadata.payoutDispatches : [];
    const payoutDispatchAuditLog = Array.isArray(existingMetadata.payoutDispatchAuditLog) ? existingMetadata.payoutDispatchAuditLog : [];
    const payoutStatus = gatewayResult.success ? 'SUBMITTED' : 'FAILED';
    const latestPayoutMetadata = {
      payoutReference,
      latestPayoutReference: payoutReference,
      lastPayoutParty: party,
      lastPayoutStatus: payoutStatus,
      lastPayoutRequestedAt: new Date().toISOString(),
    };
    const dispatchRecord = {
      reference: payoutReference,
      party,
      status: payoutStatus,
      amount,
      recipient,
      callbackIdentifier,
      callbackToken: callbackIdentifier,
      requestPayload,
      gatewayResult,
      requestedAt: new Date().toISOString(),
    };
    const auditEntry = {
      event: gatewayResult.success ? 'B2B_SUBMITTED' : 'B2B_SUBMIT_FAILED',
      payoutReference,
      party,
      settlementId: settlement.id,
      merchantTransactionReference: settlement.merchantTransactionReference,
      amount,
      recipientShortCode,
      accountReference: recipient.accountName,
      callbackUrl: callbackUrl ?? null,
      gatewayResultSummary: {
        success: gatewayResult.success,
        statusCode: gatewayResult.statusCode ?? null,
        responseCode: gatewayResult.responseCode ?? null,
        responseDescription: gatewayResult.responseDescription ?? null,
        error: gatewayResult.error ?? null,
      },
      payloadHash: Buffer.from(JSON.stringify(requestPayload)).toString('base64'),
      createdAt: new Date().toISOString(),
    };
    await this.repository.updateSettlementStatus(settlement.id, 'PROCESSING', {
      metadata: {
        ...existingMetadata,
        ...latestPayoutMetadata,
        payoutReference,
        latestPayoutReference: payoutReference,
        payoutDispatches: [...payoutDispatches, dispatchRecord],
        payoutDispatchAuditLog: [...payoutDispatchAuditLog, auditEntry],
      },
    });
    return { success: gatewayResult.success, status: dispatchRecord.status, payoutReference, gatewayResult, dispatchRecord };
  }
}
