import { Logger, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { prisma } from '../../../common/database/prisma';
import { retailerEscrowB2bService } from './retailer-escrow-b2b.service';
import { failEscrowTransfer, getEscrowResult, updateEscrowSettlementMetadata, type EscrowJsonRecord } from '../retailer-escrow-transfer.helpers';

class RetailerEscrowPayoutFlowService {
  private readonly logger = new Logger(RetailerEscrowPayoutFlowService.name);

  async handleTransferCallback(transferId: string, body: EscrowJsonRecord): Promise<EscrowJsonRecord> {
    const transfer = await prisma.retailerEscrowTransfer.findUnique({ where: { id: transferId } });
    if (!transfer) throw new NotFoundException(`Escrow transfer ${transferId} was not found`);
    if (transfer.status !== 'TRANSFER_PENDING') {
      this.logger.warn('[ESCROW_TRANSFER][TRANSFER_CALLBACK][DUPLICATE]', {
        settlementId: transfer.settlementId,
        transferId,
        status: transfer.status,
      });
      return { received: true, duplicate: true, status: transfer.status };
    }

    const result = getEscrowResult(body);
    const resultCode = String(result.ResultCode ?? result.resultCode ?? '');
    this.logger.log('[ESCROW_TRANSFER][TRANSFER_CALLBACK][RECEIVED]', {
      settlementId: transfer.settlementId,
      transferId,
      resultCode,
      resultDescription: result.ResultDesc ?? result.ResultDescription,
      transactionId: result.TransactionID ?? result.transactionId,
      originatorConversationId: result.OriginatorConversationID ?? result.originatorConversationId,
      conversationId: result.ConversationID ?? result.conversationId,
    });
    if (resultCode !== '0') {
      const reason = String(result.ResultDesc ?? result.ResultDescription ?? 'M-Pesa escrow B2B transfer failed');
      this.logger.error('[ESCROW_TRANSFER][TRANSFER_CALLBACK][FAILED]', { settlementId: transfer.settlementId, transferId, resultCode, reason });
      await failEscrowTransfer(transfer.id, reason, 'FAILED', body, Number(transfer.observedBalance), 'transfer');
      return { received: true, accepted: false, reason };
    }

    await prisma.$transaction(async (tx) => {
      const current = await tx.retailerEscrowTransfer.findUniqueOrThrow({ where: { id: transfer.id } });
      if (current.status !== 'TRANSFER_PENDING') return;
      const float = await tx.retailerEscrowFloat.findUniqueOrThrow({ where: { id: current.retailerEscrowFloatId } });
      const nextBalance = Math.max(0, Number(float.expectedRemainingBalance) - Number(current.amount));
      await tx.retailerEscrowFloat.update({
        where: { id: float.id },
        data: {
          expectedRemainingBalance: new Prisma.Decimal(nextBalance),
          activeTransferId: null,
        },
      });
      await tx.retailerEscrowTransfer.update({
        where: { id: current.id },
        data: { status: 'SUCCEEDED', transferCallback: body as Prisma.InputJsonValue },
      });
      await updateEscrowSettlementMetadata(current.settlementId, {
        escrowStatus: 'SUCCEEDED',
        cashAmount: Number(current.amount),
        expectedRemainingBalance: nextBalance,
        transferCallback: body,
      }, tx);
    });

    const settlement = await prisma.settlement.findUnique({ where: { id: transfer.settlementId } });
    this.logger.log('[ESCROW_TRANSFER][COMPLETE]', {
      settlementId: transfer.settlementId,
      transferId,
      status: 'SUCCEEDED',
      merchantTransactionReference: settlement?.merchantTransactionReference,
    });
    return {
      received: true,
      accepted: true,
      status: 'SUCCEEDED',
      transferId: transfer.id,
      merchantTransactionReference: settlement?.merchantTransactionReference,
    };
  }

  async handleTransferTimeout(transferId: string, body: EscrowJsonRecord): Promise<EscrowJsonRecord> {
    const transfer = await prisma.retailerEscrowTransfer.findUnique({ where: { id: transferId } });
    if (!transfer) throw new NotFoundException(`Escrow transfer ${transferId} was not found`);
    if (transfer.status !== 'TRANSFER_PENDING') {
      return { received: true, duplicate: true, status: transfer.status };
    }
    this.logger.error('[ESCROW_TRANSFER][B2B_TRANSFER][TIMEOUT]', {
      settlementId: transfer.settlementId,
      transferId,
      status: 'TRANSFER_OUTCOME_UNKNOWN',
    });
    await updateEscrowSettlementMetadata(transfer.settlementId, {
      escrowStatus: 'TRANSFER_OUTCOME_UNKNOWN',
      transferTimeoutAt: new Date().toISOString(),
      transferTimeout: body,
    });
    return {
      received: true,
      accepted: true,
      status: 'TRANSFER_PENDING',
      outcome: 'UNKNOWN',
      transferId,
      message: 'Transfer timeout received. The retailer float remains locked until the result callback confirms the outcome.',
    };
  }

  async dispatchB2bTransfer(transferId: string): Promise<EscrowJsonRecord> {
    const transfer = await prisma.retailerEscrowTransfer.findUniqueOrThrow({ where: { id: transferId } });
    if (transfer.status === 'TRANSFER_PENDING' || transfer.status === 'SUCCEEDED') {
      this.logger.log('[ESCROW_TRANSFER][B2B_TRANSFER][SKIPPED]', {
        settlementId: transfer.settlementId,
        transferId,
        status: transfer.status,
        reason: 'Transfer is already pending or completed',
      });
      return { accepted: true, status: transfer.status, transferId };
    }
    if (transfer.status !== 'BALANCE_VERIFIED' && transfer.status !== 'WAITING_FOR_MPESA') {
      this.logger.warn('[ESCROW_TRANSFER][B2B_TRANSFER][SKIPPED]', {
        settlementId: transfer.settlementId,
        transferId,
        status: transfer.status,
        reason: 'Balance is not verified or M-Pesa funding is not pending',
      });
      return { accepted: false, status: transfer.status, transferId };
    }
    if (Number(transfer.mpesaAmount) > 0 && transfer.mpesaStatus !== 'SUCCESS') {
      this.logger.log('[ESCROW_TRANSFER][B2B_TRANSFER][WAITING_FOR_MPESA]', {
        settlementId: transfer.settlementId,
        transferId,
        mpesaStatus: transfer.mpesaStatus,
      });
      return { accepted: true, status: 'WAITING_FOR_MPESA', transferId };
    }

    await prisma.retailerEscrowTransfer.update({ where: { id: transferId }, data: { status: 'TRANSFER_PENDING' } });
    await updateEscrowSettlementMetadata(transfer.settlementId, { escrowStatus: 'TRANSFER_PENDING' });
    this.logger.log('[ESCROW_TRANSFER][B2B_TRANSFER][DISPATCH_READY]', {
      settlementId: transfer.settlementId,
      transferId,
      amount: Number(transfer.amount),
      observedBalance: transfer.observedBalance === null ? null : Number(transfer.observedBalance),
      mpesaAmount: Number(transfer.mpesaAmount),
      mpesaStatus: transfer.mpesaStatus,
    });
    try {
      const settlement = await prisma.settlement.findUniqueOrThrow({ where: { id: transfer.settlementId } });
      this.logger.log('[ESCROW_TRANSFER][B2B_TRANSFER][START]', {
        settlementId: transfer.settlementId,
        transferId,
        amount: Number(transfer.amount),
        merchantTransactionReference: settlement.merchantTransactionReference,
      });
      const response = await retailerEscrowB2bService.transferToPayAssure({
        amount: Number(transfer.amount),
        merchantTransactionReference: settlement.merchantTransactionReference,
        callbackPath: `escrow-transfer/${transfer.id}`,
        timeoutCallbackPath: `escrow-transfer-timeout/${transfer.id}`,
        settlementId: transfer.settlementId,
        transferId: transfer.id,
      });
      if (response.success !== true) {
        throw new Error(String(response.responseDescription ?? 'M-Pesa did not accept the escrow transfer'));
      }
      await prisma.retailerEscrowTransfer.update({
        where: { id: transferId },
        data: {
          b2bOriginatorConversationId: String(response.originatorConversationId ?? '') || null,
          b2bConversationId: String(response.conversationId ?? '') || null,
        },
      });
      this.logger.log('[ESCROW_TRANSFER][B2B_TRANSFER][ACCEPTED]', {
        settlementId: transfer.settlementId,
        transferId,
        originatorConversationId: response.originatorConversationId,
        conversationId: response.conversationId,
      });
      return { accepted: true, status: 'TRANSFER_PENDING', transferId, transferRequest: response };
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      this.logger.error('[ESCROW_TRANSFER][B2B_TRANSFER][FAILED]', {
        settlementId: transfer.settlementId,
        transferId,
        error: reason,
      });
      await failEscrowTransfer(transferId, reason, 'FAILED');
      return { accepted: false, status: 'FAILED', transferId, reason };
    }
  }
}

export const retailerEscrowPayoutFlowService = new RetailerEscrowPayoutFlowService();