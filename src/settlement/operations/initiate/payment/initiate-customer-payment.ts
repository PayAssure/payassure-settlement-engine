import { retailerEscrowTransferService } from '../../../../retailer';
import type { SettlementInitiationContext } from '../context';
import { normalizePaymentMethods } from './normalize-payment-methods';
import { initiateMpesaCustomerPayment } from './initiate-mpesa-customer-payment';
import { startLiveEscrowBalanceCheck } from './start-live-escrow-balance-check';
import { buildSettlementResult } from '../helpers/build-settlement-result';
import { SettlementStatus } from '@prisma/client';

export async function initiateCustomerPayment(context: SettlementInitiationContext) {
  const { data, logger, retailerMerchantId, repository, primarySettlement } = context;
  const settlementFundingMethods = normalizePaymentMethods(data);
  const cashAmount = settlementFundingMethods
    .filter((method) => String(method.type ?? '').trim().toUpperCase() === 'CASH')
    .reduce((sum, method) => sum + Number(method.amount ?? 0), 0);
  const mpesaFundingMethod = settlementFundingMethods.find((method) => String(method.type ?? '').trim().toUpperCase() === 'MPESA');
  const mpesaAmount = settlementFundingMethods
    .filter((method) => String(method.type ?? '').trim().toUpperCase() === 'MPESA')
    .reduce((sum, method) => sum + Number(method.amount ?? 0), 0);
  const mpesaPayerPhoneNumber = String(
    mpesaFundingMethod?.payerPhoneNumber
      ?? mpesaFundingMethod?.phoneNumber
      ?? data.paymentMethod?.payerPhoneNumber
      ?? data.paymentMethod?.phoneNumber
      ?? '',
  ).trim();

  const settlementPlan = data.metadata?.settlementPlan;
  if (settlementPlan?.settlementMode === 'DIRECT' && cashAmount > 0) {
    data.metadata = {
      ...(data.metadata ?? {}),
      fundingPlan: {
        cashAmount,
        mpesaAmount,
        mpesaStatus: mpesaAmount > 0 ? 'WAITING_FOR_CUSTOMER' : 'NOT_REQUIRED',
        cashStatus: 'RECEIVED_BY_RETAILER',
        retailerMerchantId,
      },
    };
    if (mpesaAmount <= 0) return undefined;

    await repository.updateSettlementStatus(primarySettlement.id, SettlementStatus.PENDING_PROCESSING, {
      metadata: data.metadata,
    });
    const paymentResult = await initiateMpesaCustomerPayment(context, {
      amount: mpesaAmount,
      payerPhoneNumber: mpesaPayerPhoneNumber,
    });
    if (paymentResult) return paymentResult;
    return {
      success: true,
      settlement: buildSettlementResult(context, {
        status: SettlementStatus.PENDING_PROCESSING,
        estimatedProcessingTime: 'Awaiting M-Pesa collection callback',
      }),
      message: 'Direct mixed-funding settlement is awaiting M-Pesa collection. The retailer cash portion is already received and will not be paid out.',
    };
  }

  if (cashAmount > 0) {
    const escrowDebitAmount = Number(settlementPlan?.escrowDebitAmount ?? cashAmount);
    if (escrowDebitAmount <= 0) return undefined;
    const hasLiveEscrowFloat = await retailerEscrowTransferService.hasFloatConfig(retailerMerchantId);
    if (mpesaAmount > 0) {
      const fundingPlan = {
        cashAmount: escrowDebitAmount,
        mpesaAmount,
        mpesaStatus: 'WAITING_FOR_CUSTOMER',
        cashStatus: 'WAITING_FOR_MPESA',
        retailerMerchantId,
      };
      data.metadata = { ...(data.metadata ?? {}), fundingPlan };
      if (!hasLiveEscrowFloat) {
        return startLiveEscrowBalanceCheck(context, { cashAmount: escrowDebitAmount, hasLiveEscrowFloat });
      }
      await repository.updateSettlementStatus(primarySettlement.id, SettlementStatus.PENDING_PROCESSING, {
        metadata: data.metadata,
      });
      const paymentResult = await initiateMpesaCustomerPayment(context, {
        amount: mpesaAmount,
        payerPhoneNumber: mpesaPayerPhoneNumber,
      });
      if (paymentResult) return paymentResult;
      return {
        success: true,
        settlement: buildSettlementResult(context, {
          status: SettlementStatus.PENDING_PROCESSING,
          estimatedProcessingTime: 'Awaiting M-Pesa collection callback',
        }),
        message: 'M-Pesa customer collection started. The retailer cash balance will be checked and reserved after the successful collection callback.',
      };
    }
    return startLiveEscrowBalanceCheck(context, { cashAmount: escrowDebitAmount, hasLiveEscrowFloat });
  }

  if (mpesaFundingMethod) {
    return initiateMpesaCustomerPayment(context, {
      amount: mpesaAmount,
      payerPhoneNumber: mpesaPayerPhoneNumber,
    });
  }

  return undefined;
}