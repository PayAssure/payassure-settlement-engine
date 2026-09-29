import { retailerEscrowTransferService } from '../../../../retailer';
import { MockBankEscrowProvider } from '../../../../escrow-intelligence/providers/mock-bank-escrow.provider';
import type { SettlementInitiationContext } from '../context';
import { normalizePaymentMethods } from './normalize-payment-methods';
import { initiateMpesaCustomerPayment } from './initiate-mpesa-customer-payment';
import { startLiveEscrowBalanceCheck } from './start-live-escrow-balance-check';

export async function initiateCustomerPayment(context: SettlementInitiationContext) {
  const { data, logger, businessId, integrationId, retailerMerchantId } = context;
  const settlementFundingMethods = normalizePaymentMethods(data);

  if (settlementFundingMethods.length > 0 && settlementFundingMethods.some((method) => (
    ['CASH', 'ESCROW'].includes(String(method.type ?? '').trim().toUpperCase())
  ))) {
    const escrowCustomerId = retailerMerchantId || businessId;
    const cashAmount = settlementFundingMethods
      .filter((method) => String(method.type ?? '').trim().toUpperCase() === 'CASH')
      .reduce((sum, method) => sum + Number(method.amount ?? 0), 0);
    const mpesaAmount = settlementFundingMethods
      .filter((method) => String(method.type ?? '').trim().toUpperCase() === 'MPESA')
      .reduce((sum, method) => sum + Number(method.amount ?? 0), 0);
    const retailerOutstandingBalance = Number(data.totalAmount ?? 0)
      - (data.suppliers ?? []).reduce((sum, supplier) => sum + Number(
        (Array.isArray(supplier.items) ? supplier.items : []).reduce((itemTotal, item) => itemTotal + Number(item.supplierAmount ?? 0), 0)
        || Number(supplier.supplierTotalAmount ?? 0),
      ), 0)
      - Number((data.suppliers ?? []).reduce((sum, supplier) => sum + Number(supplier.platformFee ?? 0), 0));

    logger.warn('[CASH_FLOW][MULTI_FUNDING_SUMMARY]', {
      businessId,
      integrationId,
      retailerMerchantId,
      escrowCustomerId,
      merchantTransactionReference: data.merchantTransactionReference,
      totalAmount: Number(data.totalAmount ?? 0),
      fundingMethods: settlementFundingMethods,
      cashAmount,
      mpesaAmount,
      retailerOutstandingBalance,
      supplierCount: data.suppliers?.length ?? 0,
      transactionDate: data.transactionDate,
    });

    const mpesaFundingMethod = settlementFundingMethods.find((method) => String(method.type ?? '').trim().toUpperCase() === 'MPESA');
    const mpesaPayerPhoneNumber = String(
      mpesaFundingMethod?.payerPhoneNumber
        ?? mpesaFundingMethod?.phoneNumber
        ?? data.paymentMethod?.payerPhoneNumber
        ?? data.paymentMethod?.phoneNumber
        ?? '',
    ).trim();
    const hasLiveEscrowFloat = await retailerEscrowTransferService.hasFloatConfig(retailerMerchantId);

    if (cashAmount > 0) {
      return startLiveEscrowBalanceCheck(context, {
        cashAmount,
        mpesaAmount,
        mpesaPayerPhoneNumber,
        hasLiveEscrowFloat,
      });
    }

    await new MockBankEscrowProvider().getCustomerEscrowBalance(escrowCustomerId);
  }

  if (data.paymentMethod?.type?.toUpperCase() === 'MPESA') {
    return initiateMpesaCustomerPayment(context);
  }

  return undefined;
}