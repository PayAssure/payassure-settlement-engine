import { Logger, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { prisma } from '../../../common/database/prisma';
import { retailerEscrowMpesaFundingService } from '../transfer/retailer-escrow-mpesa-funding.service';
import { retailerEscrowPayoutFlowService } from '../transfer/retailer-escrow-payout-flow.service';
import { failEscrowTransfer, getEscrowResult, readEscrowWorkingBalance, updateEscrowSettlementMetadata, type EscrowJsonRecord } from '../retailer-escrow-transfer.helpers';

class RetailerEscrowBalanceCallbackService {
  private readonly logger = new Logger(RetailerEscrowBalanceCallbackService.name);

  async handleCallback(transferId: string, body: EscrowJsonRecord): Promise<EscrowJsonRecord> {
    const transfer = await prisma.retailerEscrowTransfer.findUnique({ where: { id: transferId } });
    if (!transfer) throw new NotFoundException(`Escrow transfer ${transferId} was not found`);
    if (transfer.status !== 'BALANCE_PENDING') {
      this.logger.warn('[ESCROW_TRANSFER][BALANCE_CALLBACK][DUPLICATE]', {
        settlementId: transfer.settlementId,
        transferId,
        status: transfer.status,
      });
      return { received: true, duplicate: true, status: transfer.status };
    }

    const result = getEscrowResult(body);
    const resultCode = String(result.ResultCode ?? result.resultCode ?? '');
    this.logger.log('[ESCROW_TRANSFER][BALANCE_CALLBACK][RECEIVED]', {
      settlementId: transfer.settlementId,
      transferId,
      resultCode,
      resultDescription: result.ResultDesc ?? result.ResultDescription,
      originatorConversationId: result.OriginatorConversationID ?? result.originatorConversationId,
      conversationId: result.ConversationID ?? result.conversationId,
    });
    if (resultCode !== '0') {
      const reason = String(result.ResultDesc ?? result.ResultDescription ?? 'M-Pesa account balance query failed');
      this.logger.warn('[ESCROW_TRANSFER][BALANCE_CALLBACK][REJECTED]', { settlementId: transfer.settlementId, transferId, resultCode, reason });
      await failEscrowTransfer(transfer.id, reason, 'FAILED', body);
      return { received: true, accepted: false, reason };
    }

    const observedBalance = readEscrowWorkingBalance(result);
    if (observedBalance === null) {
      const reason = 'M-Pesa account balance callback did not contain a parseable Working Account balance';
      this.logger.warn('[ESCROW_TRANSFER][BALANCE_CALLBACK][INVALID_BALANCE]', { settlementId: transfer.settlementId, transferId });
      await failEscrowTransfer(transfer.id, reason, 'FAILED', body);
      return { received: true, accepted: false, reason };
    }

    const requiredBalance = Number(transfer.requiredBalance);
    const transferAmount = Number(transfer.amount);
    if (observedBalance < requiredBalance) {
      const reason = `Escrow balance tampering detected: expected at least ${requiredBalance} KES, observed ${observedBalance} KES. Top up the escrow account and retry with a new transaction reference.`;
      this.logger.warn('[ESCROW_TRANSFER][BALANCE_CALLBACK][BALANCE_MISMATCH]', {
        settlementId: transfer.settlementId,
        transferId,
        observedBalance,
        requiredBalance,
        cashAmount: transferAmount,
        mismatch: 'EXPECTED_REMAINDER',
      });
      await failEscrowTransfer(transfer.id, reason, 'BALANCE_MISMATCH', body, observedBalance);
      return { received: true, accepted: false, reason };
    }
    if (observedBalance < transferAmount) {
      const shortfall = transferAmount - observedBalance;
      const reason = `Insufficient escrow balance: available ${observedBalance} KES; CASH amount required ${transferAmount} KES. Top up the retailer escrow account by at least ${shortfall} KES, then retry with a new transaction reference.`;
      this.logger.warn('[ESCROW_TRANSFER][BALANCE_CALLBACK][BALANCE_MISMATCH]', {
        settlementId: transfer.settlementId,
        transferId,
        observedBalance,
        cashAmount: transferAmount,
        shortfall,
        mismatch: 'CASH_AMOUNT',
        action: 'TOP_UP_REQUIRED',
      });
      await failEscrowTransfer(transfer.id, reason, 'BALANCE_MISMATCH', body, observedBalance);
      return { received: true, accepted: false, reason };
    }

    await prisma.retailerEscrowTransfer.update({
      where: { id: transfer.id },
      data: {
        status: 'BALANCE_VERIFIED',
        observedBalance: new Prisma.Decimal(observedBalance),
        balanceCallback: body as Prisma.InputJsonValue,
      },
    });
    await updateEscrowSettlementMetadata(transfer.settlementId, {
      escrowStatus: 'BALANCE_VERIFIED',
      observedBalance,
      requiredBalance,
      cashAmount: transferAmount,
    });
    this.logger.log('[ESCROW_TRANSFER][BALANCE_CALLBACK][VERIFIED]', {
      settlementId: transfer.settlementId,
      transferId,
      observedBalance,
      expectedRemainingBalance: requiredBalance,
      cashAmount: transferAmount,
    });

    if (Number(transfer.mpesaAmount) > 0) {
      return retailerEscrowMpesaFundingService.startFunding({
        id: transfer.id,
        settlementId: transfer.settlementId,
        mpesaAmount: Number(transfer.mpesaAmount),
        mpesaPayerPhone: transfer.mpesaPayerPhone,
      });
    }

    return retailerEscrowPayoutFlowService.dispatchB2bTransfer(transfer.id);
  }
}

export const retailerEscrowBalanceCallbackService = new RetailerEscrowBalanceCallbackService();