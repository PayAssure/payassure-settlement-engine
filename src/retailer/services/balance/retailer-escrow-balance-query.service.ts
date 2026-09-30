import { ConflictException, Logger, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { prisma } from '../../../common/database/prisma';
import { getRetailerEscrowMpesaConfig } from '../../config/retailer-escrow.env';
import { retailerEscrowBalanceService } from './retailer-escrow-balance.service';
import { failEscrowTransfer, updateEscrowSettlementMetadata, type EscrowJsonRecord } from '../retailer-escrow-transfer.helpers';

class RetailerEscrowBalanceQueryService {
  private readonly logger = new Logger(RetailerEscrowBalanceQueryService.name);

  async startForSettlement(request: {
    settlementId: string;
    merchantTransactionReference: string;
    retailerMerchantId: string;
    cashAmount: number;
    mpesaAmount: number;
    mpesaPayerPhone?: string;
  }): Promise<EscrowJsonRecord> {
    this.logger.log('[ESCROW_TRANSFER][START]', {
      settlementId: request.settlementId,
      merchantTransactionReference: request.merchantTransactionReference,
      retailerMerchantId: request.retailerMerchantId,
      cashAmount: request.cashAmount,
      mpesaAmount: request.mpesaAmount,
    });
    if (!Number.isFinite(request.cashAmount) || request.cashAmount <= 0) {
      throw new Error('cashAmount must be greater than zero');
    }
    if (!Number.isInteger(request.cashAmount)) {
      throw new Error('cashAmount must be an integer amount in KES');
    }
    if (!Number.isInteger(request.mpesaAmount)) {
      throw new Error('mpesaAmount must be an integer amount in KES');
    }
    if (request.mpesaAmount > 0 && !request.mpesaPayerPhone) {
      throw new Error('An M-Pesa payer phone number is required for mixed funding');
    }

    const config = await prisma.retailerEscrowFloat.findUnique({
      where: { merchantId: request.retailerMerchantId },
    });
    if (!config) {
      this.logger.warn('[ESCROW_TRANSFER][FLOAT_CONFIG][MISSING]', {
        settlementId: request.settlementId,
        retailerMerchantId: request.retailerMerchantId,
      });
      throw new NotFoundException(`Escrow float is not configured for retailer ${request.retailerMerchantId}`);
    }
    getRetailerEscrowMpesaConfig();
    this.logger.log('[ESCROW_TRANSFER][FLOAT_CONFIG][LOADED]', {
      settlementId: request.settlementId,
      retailerMerchantId: request.retailerMerchantId,
      dailyFloat: Number(config.dailyFloat),
      expectedRemainingBalance: Number(config.expectedRemainingBalance),
      transferInProgress: Boolean(config.activeTransferId),
    });
    this.logger.log('[ESCROW_TRANSFER][FLOAT_LOCK][START]', {
      settlementId: request.settlementId,
      retailerMerchantId: request.retailerMerchantId,
      expectedRemainingBalance: Number(config.expectedRemainingBalance),
    });

    const transferId = randomUUID();
    let created;
    try {
      created = await prisma.$transaction(async (tx) => {
        const claimed = await tx.retailerEscrowFloat.updateMany({
          where: {
            id: config.id,
            activeTransferId: null,
            expectedRemainingBalance: config.expectedRemainingBalance,
          },
          data: { activeTransferId: transferId },
        });
        if (claimed.count !== 1) {
          throw new ConflictException('Another escrow transfer is already active or the expected float changed');
        }
        return tx.retailerEscrowTransfer.create({
          data: {
            id: transferId,
            settlementId: request.settlementId,
            retailerEscrowFloatId: config.id,
            retailerMerchantId: request.retailerMerchantId,
            amount: new Prisma.Decimal(request.cashAmount),
            mpesaAmount: new Prisma.Decimal(request.mpesaAmount),
            mpesaPayerPhone: request.mpesaPayerPhone ?? null,
            mpesaStatus: request.mpesaAmount > 0 ? 'NOT_STARTED' : 'NOT_REQUIRED',
            requiredBalance: config.expectedRemainingBalance,
            status: 'BALANCE_PENDING',
          },
        });
      });
    } catch (error) {
      this.logger.warn('[ESCROW_TRANSFER][FLOAT_LOCK][FAILED]', {
        settlementId: request.settlementId,
        transferId,
        retailerMerchantId: request.retailerMerchantId,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
    await updateEscrowSettlementMetadata(request.settlementId, {
      escrowStatus: 'BALANCE_PENDING',
      transferId: created.id,
      cashAmount: request.cashAmount,
      mpesaAmount: request.mpesaAmount,
    });
    this.logger.log('[ESCROW_TRANSFER][FLOAT_LOCK][ACQUIRED]', {
      settlementId: request.settlementId,
      transferId: created.id,
      retailerMerchantId: request.retailerMerchantId,
      requiredBalance: Number(config.expectedRemainingBalance),
    });
    this.logger.log('[ESCROW_TRANSFER][RECORD][CREATED]', {
      settlementId: request.settlementId,
      transferId: created.id,
      merchantTransactionReference: request.merchantTransactionReference,
      cashAmount: request.cashAmount,
      mpesaAmount: request.mpesaAmount,
      status: created.status,
    });

    try {
      this.logger.log('[ESCROW_TRANSFER][BALANCE_QUERY][START]', {
        settlementId: request.settlementId,
        transferId: created.id,
        retailerMerchantId: request.retailerMerchantId,
        provider: 'MPESA_RETAILER_ESCROW',
      });
      const response = await retailerEscrowBalanceService.queryBalance(
        `escrow-balance/${created.id}`,
        `escrow-balance-timeout/${created.id}`,
        {
          settlementId: request.settlementId,
          transferId: created.id,
          retailerMerchantId: request.retailerMerchantId,
        },
      );
      const responseCode = String(response.responseCode ?? response.ResponseCode ?? '');
      const responseDescription = String(response.responseDescription ?? response.ResponseDescription ?? 'Safaricom did not accept the account balance query');
      if (responseCode !== '0') throw new Error(responseDescription);

      await prisma.retailerEscrowTransfer.update({
        where: { id: created.id },
        data: {
          balanceOriginatorConversationId: String(response.originatorConversationId ?? response.OriginatorConversationID ?? '') || null,
          balanceConversationId: String(response.conversationId ?? response.ConversationID ?? '') || null,
        },
      });
      this.logger.log('[ESCROW_TRANSFER][BALANCE_QUERY][ACCEPTED]', {
        settlementId: request.settlementId,
        transferId: created.id,
        responseCode,
        originatorConversationId: response.originatorConversationId ?? response.OriginatorConversationID,
        conversationId: response.conversationId ?? response.ConversationID,
      });
      return { transferId: created.id, status: 'BALANCE_PENDING', balanceRequest: response };
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      this.logger.error('[ESCROW_TRANSFER][BALANCE_QUERY][FAILED]', {
        settlementId: request.settlementId,
        transferId: created.id,
        retailerMerchantId: request.retailerMerchantId,
        error: reason,
      });
      await failEscrowTransfer(created.id, reason, 'FAILED');
      throw error;
    }
  }

  async handleTimeout(transferId: string, body: EscrowJsonRecord): Promise<EscrowJsonRecord> {
    const transfer = await prisma.retailerEscrowTransfer.findUnique({ where: { id: transferId } });
    if (!transfer) throw new NotFoundException(`Escrow transfer ${transferId} was not found`);
    if (transfer.status !== 'BALANCE_PENDING') {
      return { received: true, duplicate: true, status: transfer.status };
    }
    const reason = 'M-Pesa account balance request timed out before a result was received';
    this.logger.error('[ESCROW_TRANSFER][BALANCE_QUERY][TIMEOUT]', { settlementId: transfer.settlementId, transferId });
    await failEscrowTransfer(transfer.id, reason, 'FAILED', body);
    return { received: true, accepted: false, status: 'FAILED', reason };
  }
}

export const retailerEscrowBalanceQueryService = new RetailerEscrowBalanceQueryService();