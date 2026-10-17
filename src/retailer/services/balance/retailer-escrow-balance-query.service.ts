import { BadRequestException, Logger, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { prisma } from '../../../common/database/prisma';
import { retailerEscrowFloatService } from '../retailer-escrow-float.service';
import { retailerEscrowMpesaFundingService } from '../transfer/retailer-escrow-mpesa-funding.service';
import { retailerEscrowPayoutFlowService } from '../transfer/retailer-escrow-payout-flow.service';
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
    this.logger.log('[ESCROW_TRANSFER][FLOAT_CONFIG][LOADED]', {
      settlementId: request.settlementId,
      retailerMerchantId: request.retailerMerchantId,
      dailyFloat: Number(config.dailyFloat),
      transferInProgress: Boolean(config.activeTransferId),
    });
    this.logger.log('[ESCROW_TRANSFER][FLOAT_LOCK][START]', {
      settlementId: request.settlementId,
      retailerMerchantId: request.retailerMerchantId,
    });

    const transferId = randomUUID();
    let created: Awaited<ReturnType<typeof prisma.retailerEscrowTransfer.create>>;
    let availableBalance = 0;
    try {
      ({ created, availableBalance } = await prisma.$transaction(async (tx) => {
        const claimed = await tx.retailerEscrowFloat.updateMany({
          where: { id: config.id },
          data: { activeTransferId: transferId },
        });
        if (claimed.count !== 1) {
          throw new NotFoundException(`Escrow float for retailer ${request.retailerMerchantId} was not found`);
        }
        const currentAvailableBalance = await retailerEscrowFloatService.getAvailableBalance(config.id, tx);
        if (currentAvailableBalance < request.cashAmount) {
          const shortfall = request.cashAmount - currentAvailableBalance;
          throw new BadRequestException(
            `Insufficient retailer escrow balance: available ${currentAvailableBalance} KES; requested ${request.cashAmount} KES; shortfall ${shortfall} KES.`,
          );
        }
        const transfer = await tx.retailerEscrowTransfer.create({
          data: {
            id: transferId,
            settlementId: request.settlementId,
            retailerEscrowFloatId: config.id,
            retailerMerchantId: request.retailerMerchantId,
            amount: new Prisma.Decimal(request.cashAmount),
            mpesaAmount: new Prisma.Decimal(request.mpesaAmount),
            mpesaPayerPhone: request.mpesaPayerPhone ?? null,
            mpesaStatus: request.mpesaAmount > 0 ? 'NOT_STARTED' : 'NOT_REQUIRED',
            requiredBalance: new Prisma.Decimal(currentAvailableBalance),
            status: 'BALANCE_VERIFIED',
          },
        });
        await tx.retailerEscrowFloat.updateMany({
          where: { id: config.id, activeTransferId: transferId },
          data: { activeTransferId: null },
        });
        return { created: transfer, availableBalance: currentAvailableBalance };
      }));
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
      escrowStatus: 'BALANCE_VERIFIED',
      transferId: created.id,
      cashAmount: request.cashAmount,
      mpesaAmount: request.mpesaAmount,
      availableBalance,
    });
    this.logger.log('[ESCROW_TRANSFER][FLOAT_LOCK][ACQUIRED]', {
      settlementId: request.settlementId,
      transferId: created.id,
      retailerMerchantId: request.retailerMerchantId,
      requiredBalance: availableBalance,
    });
    this.logger.log('[ESCROW_TRANSFER][RECORD][CREATED]', {
      settlementId: request.settlementId,
      transferId: created.id,
      merchantTransactionReference: request.merchantTransactionReference,
      cashAmount: request.cashAmount,
      mpesaAmount: request.mpesaAmount,
      status: created.status,
    });

    this.logger.log('[ESCROW_TRANSFER][LEDGER_CHECK][VERIFIED]', {
      settlementId: request.settlementId,
      transferId: created.id,
      retailerMerchantId: request.retailerMerchantId,
      availableBalance,
      cashAmount: request.cashAmount,
      projectedBalanceAfterSuccess: availableBalance - request.cashAmount,
    });

    if (request.mpesaAmount > 0) {
      return retailerEscrowMpesaFundingService.startFunding({
        id: created.id,
        settlementId: request.settlementId,
        mpesaAmount: request.mpesaAmount,
        mpesaPayerPhone: request.mpesaPayerPhone ?? null,
      });
    }

    return retailerEscrowPayoutFlowService.dispatchB2bTransfer(created.id);
  }

  async startStandaloneTransfer(retailerMerchantId: string, amount: number): Promise<EscrowJsonRecord> {
    if (!Number.isFinite(amount) || amount <= 0 || !Number.isInteger(amount)) {
      throw new BadRequestException('amount must be a positive integer amount in KES');
    }

    const config = await prisma.retailerEscrowFloat.findUnique({
      where: { merchantId: retailerMerchantId },
    });
    if (!config) {
      throw new NotFoundException(`Escrow float is not configured for retailer ${retailerMerchantId}`);
    }

    const transferId = randomUUID();
    const merchantTransactionReference = `E${randomUUID().replace(/-/g, '').slice(0, 11).toUpperCase()}`;
    await prisma.$transaction(async (tx) => {
      const claimed = await tx.retailerEscrowFloat.updateMany({
        where: { id: config.id },
        data: { activeTransferId: transferId },
      });
      if (claimed.count !== 1) {
        throw new NotFoundException(`Escrow float for retailer ${retailerMerchantId} was not found`);
      }
      await tx.retailerEscrowTransfer.create({
        data: {
          id: transferId,
          settlementId: null,
          retailerEscrowFloatId: config.id,
          retailerMerchantId,
          merchantTransactionReference,
          amount: new Prisma.Decimal(amount),
          mpesaAmount: new Prisma.Decimal(0),
          mpesaStatus: 'NOT_REQUIRED',
          requiredBalance: new Prisma.Decimal(0),
          status: 'BALANCE_VERIFIED',
        },
      });
      await tx.retailerEscrowFloat.updateMany({
        where: { id: config.id, activeTransferId: transferId },
        data: { activeTransferId: null },
      });
    });

    this.logger.log('[ESCROW_TRANSFER][STANDALONE][CREATED]', {
      retailerMerchantId,
      transferId,
      merchantTransactionReference,
      amount,
    });
    return retailerEscrowPayoutFlowService.dispatchB2bTransfer(transferId);
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