import { BadRequestException, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { SettlementGatewayRequestBase } from './gateway-request.base';
import type { B2bGatewayResponse } from './types';
import { finalizeSettlementPayoutReservation } from '../../retailer/services/transfer/helpers/settlement-payout-reservation';

export abstract class SettlementPayoutDispatchBase extends SettlementGatewayRequestBase {
  async markPayoutOutcomeUnknown(settlementId: string, payoutReference: string): Promise<void> {
    const settlement = await this.repository.findSettlementById(settlementId);
    if (!settlement) {
      throw new NotFoundException(`Settlement ${settlementId} was not found`);
    }
    const metadata = settlement.metadata && typeof settlement.metadata === 'object'
      ? settlement.metadata as Record<string, any>
      : {};
    const reconciliation = Array.isArray(metadata.payoutReconciliation)
      ? metadata.payoutReconciliation
      : [];
    await this.repository.updateSettlementStatus(settlementId, 'AWAITING_RECONCILIATION', {
      metadata: {
        ...metadata,
        payoutReconciliation: [...reconciliation, {
          payoutReference,
          status: 'UNKNOWN',
          reason: 'No final M-Pesa payout callback was received before the reconciliation timeout',
          flaggedAt: new Date().toISOString(),
        }],
      },
    });
  }

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
    const workingSettlement = validationSettlement ?? settlement;
    const settlementPlan = (validationMetadata.settlementPlan ?? existingMetadata.settlementPlan) as Record<string, any> | undefined;
    const payloadSuppliers = Array.isArray(workingSettlement.paymentPayload?.suppliers)
      ? workingSettlement.paymentPayload.suppliers
      : [];
    const settlementMode = String(
      settlementPlan?.settlementMode
        ?? validationMetadata.resolvedSettlementMode
        ?? (payloadSuppliers.length > 0 && payloadSuppliers.every((supplier: any) => !supplier?.supplierMerchantId) ? 'DIRECT' : ''),
    ).toUpperCase();
    const paymentMethod = String(
      settlementPlan?.paymentMethod
        ?? validationMetadata.fundingPlan?.paymentMethod
        ?? workingSettlement.paymentPayload?.paymentMethod?.type
        ?? '',
    ).toUpperCase();
    const party = String(data.party || (existingMetadata?.supplierMerchantId ? 'SUPPLIER' : 'RETAILER')).toUpperCase() as 'SUPPLIER' | 'RETAILER';

    if (settlementMode === 'DIRECT' && paymentMethod === 'CASH') {
      this.logger.warn('[PAYOUT][SKIPPED] direct cash is already received by retailer', {
        settlementId: settlement.id,
        party,
        reason: 'DIRECT_CASH_HAS_NO_PAYOUT',
      });
      return {
        success: true,
        status: 'SKIPPED',
        skipped: true,
        reason: 'DIRECT_CASH_HAS_NO_PAYOUT',
        settlementId: settlement.id,
      };
    }

    if (settlementPlan && party === 'RETAILER' && settlementMode === 'SPLIT' && paymentMethod === 'CASH') {
      return {
        success: true,
        status: 'SKIPPED',
        skipped: true,
        reason: 'CASH_ALREADY_RECEIVED_BY_RETAILER',
        settlementId: settlement.id,
      };
    }

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

    const resolvedSupplierMerchantId = this.resolveSupplierMerchantId(workingSettlement, data.supplierMerchantId);
    const resolvedRetailerMerchantId = await this.resolveRetailerMerchantId(workingSettlement);
    const resolvedPartyMerchantId = party === 'RETAILER' ? resolvedRetailerMerchantId : resolvedSupplierMerchantId;
    const payoutInstructions = Array.isArray(settlementPlan?.payoutInstructions)
      ? settlementPlan.payoutInstructions as Array<Record<string, any>>
      : null;
    const approvedInstruction = payoutInstructions
      ? payoutInstructions.find((instruction) => (
        instruction.party === party
        && (party !== 'SUPPLIER' || String(instruction.supplierMerchantId ?? '') === String(resolvedSupplierMerchantId ?? ''))
      ))
      : null;
    const plannedAmount = settlementPlan
      ? payoutInstructions
        ? Number(approvedInstruction?.amount ?? 0)
        : Number(party === 'SUPPLIER' ? settlementPlan.supplierPayoutAmount : settlementPlan.retailerPayoutAmount)
      : undefined;
    if (plannedAmount !== undefined && plannedAmount <= 0) {
      this.logger.warn('[PAYOUT][SKIPPED] no approved payout instruction', {
        settlementId: settlement.id,
        party,
        supplierMerchantId: resolvedSupplierMerchantId ?? null,
        settlementMode,
        paymentMethod,
      });
      return {
        success: true,
        status: 'SKIPPED',
        skipped: true,
        reason: 'NO_APPROVED_PAYOUT_ALLOCATION',
        settlementId: settlement.id,
      };
    }
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
    if (plannedAmount !== undefined) {
      if (amount <= 0) amount = plannedAmount;
      if (amount > plannedAmount) {
        throw new BadRequestException({
          statusCode: 400,
          message: `Payout amount ${amount} exceeds the approved ${party.toLowerCase()} allocation ${plannedAmount}`,
          error: 'PAYOUT_EXCEEDS_APPROVED_ALLOCATION',
        });
      }
      if (payoutInstructions && amount > 0 && amount !== plannedAmount) {
        throw new BadRequestException({
          statusCode: 400,
          message: `Payout amount ${amount} does not match the approved instruction amount ${plannedAmount}`,
          error: 'PAYOUT_DOES_NOT_MATCH_APPROVED_INSTRUCTION',
        });
      }
    }
    if (amount <= 0) {
      const allocation = Array.isArray(existingMetadata.allocationPlan?.allocations)
        ? existingMetadata.allocationPlan.allocations.find((alloc: any) => alloc.party === party)
        : null;
      amount = Number(allocation?.amount ?? 0);
    }
    if (amount <= 0) {
      throw new BadRequestException({ statusCode: 400, message: 'Payout amount must be greater than zero', error: 'INVALID_PAYOUT_AMOUNT' });
    }
    let roundedAmount = amount > 0 && amount < 1 ? 1 : Math.round(amount);
    if (plannedAmount !== undefined && roundedAmount > plannedAmount) {
      roundedAmount = Math.floor(plannedAmount);
    }
    if (roundedAmount <= 0) {
      throw new BadRequestException({
        statusCode: 400,
        message: 'Approved payout allocation is below the smallest supported payout amount',
        error: 'APPROVED_PAYOUT_BELOW_MINIMUM',
      });
    }

    const newCallbackIdentifier = randomUUID();
    const escrowFundedAmount = party === 'SUPPLIER'
      ? Math.min(
        roundedAmount,
        Math.max(0, Number(approvedInstruction?.escrowFundedAmount ?? data.escrowFundedAmount ?? 0)),
      )
      : 0;
    const payoutAttemptResult = await this.idempotencyService.createOrGetPayoutAttempt({
      settlementId: settlement.id,
      merchantTransactionReference: data.merchantTransactionReference,
      party,
      amount: roundedAmount,
      recipientMerchantId: resolvedPartyMerchantId ?? undefined,
      recipientType: recipient.type,
      recipientPhone: recipient.phoneNumber ?? recipient.payerPhoneNumber ?? undefined,
      callbackIdentifier: newCallbackIdentifier,
      metadata: { escrowFundedAmount },
    });
    if (!payoutAttemptResult.isNewAttempt && ['COMPLETED', 'SUCCESSFUL'].includes(payoutAttemptResult.status)) {
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
    if (!payoutAttemptResult.isNewAttempt && ['SUBMITTED', 'UNKNOWN'].includes(payoutAttemptResult.status)) {
      return {
        success: true,
        status: payoutAttemptResult.status,
        payoutReference: payoutAttemptResult.payoutReference,
        isDuplicate: true,
        message: 'Payout is awaiting its final M-Pesa callback; duplicate dispatch prevented.',
      };
    }

    const payoutReference = payoutAttemptResult.payoutReference;
    if (payoutAttemptResult.attemptCount > 1) {
      await this.repository.notifyWebhookEvent?.(settlement.id, 'payment.settlement.retrying', {
        party,
        payout_reference: payoutReference,
        attempt_count: payoutAttemptResult.attemptCount,
      });
    }
    const callbackIdentifier = payoutAttemptResult.callbackIdentifier ?? newCallbackIdentifier;
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
    const finalizedReservation = existingMetadata.escrowFunding?.payoutSource === 'CENTRAL_ACCOUNT'
      ? await finalizeSettlementPayoutReservation(settlement.id, this.prisma)
      : { finalized: false };
    if (finalizedReservation.finalized && finalizedReservation.settlementStatus === 'COMPLETED') {
      await this.repository.notifyWebhookEvent?.(settlement.id, 'payment.settlement.completed');
    } else if (finalizedReservation.finalized && finalizedReservation.settlementStatus === 'PROCESSING_FAILED') {
      await this.repository.notifyWebhookEvent?.(settlement.id, 'payment.settlement.partially_failed', {
        reason: 'One or more payout submissions failed before final M-Pesa confirmation',
      });
    }
    return { success: gatewayResult.success, status: dispatchRecord.status, payoutReference, gatewayResult, dispatchRecord };
  }
}
