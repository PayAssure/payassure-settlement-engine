import {
  BadGatewayException,
  BadRequestException,
  ConflictException,
  ForbiddenException,
  InternalServerErrorException,
  UnauthorizedException,
} from '@nestjs/common';
import { ParticipantStatus, ParticipantType, SettlementStatus } from '@prisma/client';
import type { InitiateSettlementDto } from '../dto/initiate-settlement.dto';
import { validateAndGetSession } from '../helpers/session.helpers';
import { generateInternalMerchantTransactionReference, generatePayAssureReference } from '../helpers/reference.helpers';
import { aggregateSuppliers } from './initiate/helpers/aggregate-suppliers';
import { toPublicPaymentDetails } from './initiate/helpers/to-public-payment-details';
import { normalizeCanonicalSettlement } from './initiate/helpers/normalize-canonical-settlement';
import { normalizeSettlementError } from './initiate/helpers/normalize-settlement-error';
import { findExistingSettlementResponse } from './initiate/helpers/find-existing-settlement';
import { validateAndFilterSuppliers } from './initiate/helpers/validate-and-filter-suppliers';
import { createSupplierSettlements } from './initiate/suppliers/create-supplier-settlements';
import { initiateCustomerPayment } from './initiate/payment/initiate-customer-payment';
import { normalizePaymentMethods } from './initiate/payment/normalize-payment-methods';
import { retailerEscrowTransferService } from '../../retailer';
import type { SettlementInitiationContext } from './initiate/context';
import { buildSettlementPlan } from './initiate/helpers/build-settlement-plan';

export { simulateMpesaLandingCallback } from './initiate/payment/simulate-mpesa-landing-callback';
export { sendStkPushRequestWithRetry } from './initiate/payment/stk-push-with-retry';
export { normalizeCanonicalSettlement } from './initiate/helpers/normalize-canonical-settlement';
export { normalizeSettlementError } from './initiate/helpers/normalize-settlement-error';

export async function initiateOperation(
  prisma: any,
  repository: any,
  logger: any,
  token: string,
  data: InitiateSettlementDto,
  supportedCurrencies: string[],
  allocateCashSettlement?: SettlementInitiationContext['allocateCashSettlement'],
) {
  const session = await validateAndGetSession(token, repository, logger);
  const integration = await repository.findIntegrationById(session.integrationId);
  const businessId = (session as any).businessId ?? (session as any).business?.id ?? integration?.participantId ?? integration?.participant?.id ?? 'unknown';
  const integrationId = (session as any).integrationId ?? (session as any).integration?.id ?? integration?.id ?? 'unknown';
  if (!integration || !integration.participant) {
    logger.warn(`Invalid session context: session=${token}, integrationId=${session.integrationId}`);
    throw new UnauthorizedException({ statusCode: 401, message: 'Invalid session or retailer context', error: 'INVALID_SESSION' });
  }

  const retailerMerchantId = integration.merchantId;
  if (
    integration.participant.participantType !== ParticipantType.RETAILER
    || !([ParticipantStatus.ACTIVE, ParticipantStatus.LIVE] as ParticipantStatus[]).includes(integration.participant.status)
  ) {
    logger.warn(`Retailer not authorized or inactive: merchantId=${retailerMerchantId}, status=${integration.participant.status}`);
    throw new ForbiddenException({ statusCode: 403, message: 'Retailer account is not authorized to initiate settlements', error: 'RETAILER_NOT_AUTHORIZED' });
  }

  try {
    data = normalizeCanonicalSettlement(data);
    const existingResponse = await findExistingSettlementResponse(repository, businessId, retailerMerchantId, session.id, data);
    if (existingResponse) return existingResponse;

    const invalidSuppliers = await validateAndFilterSuppliers(data, repository, logger, supportedCurrencies);

    data.suppliers = aggregateSuppliers(data.suppliers) as any;
    const settlementPlan = buildSettlementPlan(data);
    data.metadata = { ...(data.metadata ?? {}), settlementPlan };
    const cashAmount = normalizePaymentMethods(data)
      .filter((method) => String(method.type ?? '').trim().toUpperCase() === 'CASH')
      .reduce((sum, method) => sum + method.amount, 0);
    if (settlementPlan.escrowBalanceCheckRequired && !(await retailerEscrowTransferService.hasFloatConfig(retailerMerchantId))) {
      throw new BadRequestException(`Retailer escrow daily float is not configured for ${retailerMerchantId}; CASH settlement was blocked.`);
    }

    const payAssureReference = generatePayAssureReference();
    const internalMerchantTransactionReference = generateInternalMerchantTransactionReference();
    const primarySettlement = await repository.createSettlement(
      businessId,
      integrationId,
      payAssureReference,
      internalMerchantTransactionReference,
      data,
    );

    await repository.touchSession(session.id);
    if (
      settlementPlan.settlementMode === 'DIRECT'
      && settlementPlan.paymentMethod === 'CASH'
    ) {
      const completedAt = new Date();
      await repository.updateSettlementStatus(primarySettlement.id, SettlementStatus.COMPLETED, {
        completedAt,
        metadata: {
          ...(data.metadata ?? {}),
          paymentConfirmation: {
            status: 'PAID',
            provider: 'CASH',
            paidAmount: settlementPlan.cashAmount,
            confirmedAt: completedAt.toISOString(),
          },
          settlementPlan: { ...settlementPlan, settlementStatus: 'SETTLED' },
        },
      });
      logger.log('[DIRECT_SETTLEMENT][PAYOUTS_SKIPPED]', {
        settlementId: primarySettlement.id,
        settlementMode: settlementPlan.settlementMode,
        paymentMethod: settlementPlan.paymentMethod,
        retailerPayoutAmount: 0,
        supplierPayoutAmount: 0,
        escrowBalanceCheckRequired: false,
        reason: 'Cash has already been received by the retailer',
      });
      return {
        success: true,
        settlementStatus: 'SETTLED',
        settlement: {
          settlementId: primarySettlement.id,
          merchantId: retailerMerchantId,
          status: SettlementStatus.COMPLETED,
          amount: Number(primarySettlement.amount),
          retailerAmount: settlementPlan.retailerEntitlement,
          supplierAmount: 0,
          systemAmount: settlementPlan.platformFeeAmount,
          paymentDetails: toPublicPaymentDetails(data.paymentMethod),
          currency: primarySettlement.currency,
          reference: primarySettlement.reference,
          createdAt: primarySettlement.createdAt,
          estimatedProcessingTime: 'N/A',
        },
        settlementPlan: { ...settlementPlan, settlementStatus: 'SETTLED' },
        message: 'Direct cash settlement completed. No escrow reservation or payout was created.',
        children: [],
        ...(invalidSuppliers.length > 0 ? { excludedSuppliers: invalidSuppliers } : {}),
      };
    }

    const context: SettlementInitiationContext = {
      prisma,
      repository,
      logger,
      data,
      session,
      businessId,
      integrationId,
      retailerMerchantId,
      primarySettlement,
      allocateCashSettlement,
    };
    const deferredPaymentResult = await initiateCustomerPayment(context);
    if (deferredPaymentResult && !deferredPaymentResult.success) return deferredPaymentResult;

    const allocations = await createSupplierSettlements({
      ...context,
      internalMerchantTransactionReference,
    });

    if (
      deferredPaymentResult
      && 'cashAllocationReady' in deferredPaymentResult
      && deferredPaymentResult.cashAllocationReady
    ) {
      if (!context.allocateCashSettlement) {
        throw new Error('Cash settlement allocator is not configured');
      }
      const cashAllocation = await context.allocateCashSettlement({
        merchantTransactionReference: data.merchantTransactionReference,
      });
      return {
        success: cashAllocation.success,
        message: cashAllocation.message ?? 'Cash settlement allocation and payouts have been started.',
        settlement: {
          ...deferredPaymentResult.settlement,
          status: cashAllocation.status,
          estimatedProcessingTime: 'Awaiting payout callbacks',
        },
        ...('escrowFunding' in deferredPaymentResult ? { escrowFunding: deferredPaymentResult.escrowFunding } : {}),
        ...('balanceCheck' in deferredPaymentResult ? { balanceCheck: deferredPaymentResult.balanceCheck } : {}),
        cashAllocation,
        children: allocations.childSettlements,
      };
    }

    if (deferredPaymentResult) return deferredPaymentResult;

    return {
      success: true,
      settlement: {
        settlementId: primarySettlement.id,
        merchantId: retailerMerchantId,
        status: primarySettlement.status,
        amount: Number(primarySettlement.amount),
        retailerAmount: allocations.totalRetailerAmount,
        supplierAmount: allocations.totalSupplierAmount,
        systemAmount: allocations.totalSystemAmount,
        paymentDetails: toPublicPaymentDetails(data.paymentMethod),
        currency: primarySettlement.currency,
        reference: primarySettlement.reference,
        createdAt: primarySettlement.createdAt,
        estimatedProcessingTime: '24-48 hours',
      },
      message: 'Settlement request received and queued for processing',
      children: allocations.childSettlements,
      ...(invalidSuppliers.length > 0 ? { excludedSuppliers: invalidSuppliers } : {}),
    };
  } catch (error) {
    if (error instanceof BadRequestException || error instanceof ConflictException || error instanceof ForbiddenException) {
      throw error;
    }

    const err = error as Error;
    const context = { requestBody: data, settlementSessionToken: token };
    const normalized = normalizeSettlementError(err, { provider: 'M-PESA/B2POCHI', context });
    logger.error(`Settlement initiation failed: ${normalized.message} | context=${JSON.stringify(context)}`, err.stack);

    if (normalized.statusCode === 502) {
      throw new BadGatewayException({
        statusCode: 502,
        message: normalized.message,
        error: normalized.error,
        provider: normalized.provider,
        details: normalized.details,
      });
    }
    throw new InternalServerErrorException({
      statusCode: 500,
      message: normalized.message,
      error: normalized.error,
      details: normalized.details,
    });
  }
}