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

  if (cashAmount > 0) {
    const hasLiveEscrowFloat = await retailerEscrowTransferService.hasFloatConfig(retailerMerchantId);
    if (mpesaAmount > 0) {
      const fundingPlan = {
        cashAmount,
        mpesaAmount,
        mpesaStatus: 'WAITING_FOR_CUSTOMER',
        cashStatus: 'WAITING_FOR_MPESA',
        retailerMerchantId,
      };
      data.metadata = { ...(data.metadata ?? {}), fundingPlan };
      if (!hasLiveEscrowFloat) {
        return startLiveEscrowBalanceCheck(context, { cashAmount, hasLiveEscrowFloat });
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
    return startLiveEscrowBalanceCheck(context, { cashAmount, hasLiveEscrowFloat });
  }

  if (mpesaFundingMethod) {
    return initiateMpesaCustomerPayment(context, {
      amount: mpesaAmount,
      payerPhoneNumber: mpesaPayerPhoneNumber,
    });
  }

  return undefined;
}