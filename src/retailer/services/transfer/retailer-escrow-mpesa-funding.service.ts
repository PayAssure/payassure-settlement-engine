import { Logger } from '@nestjs/common';
import { prisma } from '../../../common/database/prisma';
import { mpesaService } from '../../../payment/services/mpesa.service';
import { retailerEscrowPayoutFlowService } from './retailer-escrow-payout-flow.service';
import { failEscrowTransfer, updateEscrowSettlementMetadata, type EscrowJsonRecord } from '../retailer-escrow-transfer.helpers';

class RetailerEscrowMpesaFundingService {
  private readonly logger = new Logger(RetailerEscrowMpesaFundingService.name);

  async startFunding(transfer: {
    id: string;
    settlementId: string;
    mpesaAmount: number | string;
    mpesaPayerPhone: string | null;
  }): Promise<EscrowJsonRecord> {
    await prisma.retailerEscrowTransfer.update({
      where: { id: transfer.id },
      data: { status: 'WAITING_FOR_MPESA', mpesaStatus: 'PENDING_CALLBACK' },
    });
    try {
      this.logger.log('[ESCROW_TRANSFER][MPESA_FUNDING][START]', {
        settlementId: transfer.settlementId,
        transferId: transfer.id,
        amount: Number(transfer.mpesaAmount),
      });
      const payment = await mpesaService.initiateStkPush({
        payerPhoneNumber: transfer.mpesaPayerPhone,
        amount: Number(transfer.mpesaAmount),
        merchantTransactionReference: (await prisma.settlement.findUniqueOrThrow({ where: { id: transfer.settlementId } })).merchantTransactionReference,
        accountReference: 'Payassure',
        transactionDesc: 'Mixed settlement M-Pesa funding',
        gatewayPayload: { escrowTransferId: transfer.id },
      });
      if (String(payment.responseCode ?? '') !== '0') {
        throw new Error(String(payment.responseDescription ?? 'Safaricom did not accept the M-Pesa funding request'));
      }
      this.logger.log('[ESCROW_TRANSFER][MPESA_FUNDING][ACCEPTED]', {
        settlementId: transfer.settlementId,
        transferId: transfer.id,
        responseCode: payment.responseCode,
        checkoutRequestId: payment.checkoutRequestId,
      });
      return { received: true, accepted: true, status: 'WAITING_FOR_MPESA', mpesaRequest: payment };
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      this.logger.error('[ESCROW_TRANSFER][MPESA_FUNDING][FAILED]', {
        settlementId: transfer.settlementId,
        transferId: transfer.id,
        error: reason,
      });
      await failEscrowTransfer(transfer.id, reason, 'FAILED');
      return { received: true, accepted: false, reason };
    }
  }

  async handleCallback(merchantTransactionReference: string, success: boolean): Promise<EscrowJsonRecord | null> {
    const transfer = await prisma.retailerEscrowTransfer.findFirst({
      where: { settlement: { is: { merchantTransactionReference } } },
    });
    if (!transfer || transfer.status !== 'WAITING_FOR_MPESA') {
      this.logger.warn('[ESCROW_TRANSFER][MPESA_FUNDING][CALLBACK_UNMATCHED]', {
        merchantTransactionReference,
        status: transfer?.status ?? 'NOT_FOUND',
      });
      return null;
    }

    this.logger.log('[ESCROW_TRANSFER][MPESA_FUNDING][CALLBACK_RECEIVED]', {
      settlementId: transfer.settlementId,
      transferId: transfer.id,
      success,
    });
    if (!success) {
      const reason = 'M-Pesa STK funding failed; escrow transfer was not dispatched.';
      this.logger.warn('[ESCROW_TRANSFER][MPESA_FUNDING][CALLBACK_FAILED]', {
        settlementId: transfer.settlementId,
        transferId: transfer.id,
        reason,
      });
      await failEscrowTransfer(transfer.id, reason, 'FAILED');
      return { accepted: false, status: 'FAILED', reason };
    }

    await prisma.retailerEscrowTransfer.update({ where: { id: transfer.id }, data: { mpesaStatus: 'SUCCESS' } });
    this.logger.log('[ESCROW_TRANSFER][MPESA_FUNDING][CALLBACK_SUCCEEDED]', {
      settlementId: transfer.settlementId,
      transferId: transfer.id,
    });
    await updateEscrowSettlementMetadata(transfer.settlementId, { mpesaStatus: 'SUCCESS' });
    return retailerEscrowPayoutFlowService.dispatchB2bTransfer(transfer.id);
  }

}

export const retailerEscrowMpesaFundingService = new RetailerEscrowMpesaFundingService();