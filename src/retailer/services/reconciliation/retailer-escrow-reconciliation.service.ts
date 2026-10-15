import { Logger, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { prisma } from '../../../common/database/prisma';
import { retailerEscrowBalanceService } from '../balance/retailer-escrow-balance.service';
import { getEscrowResult, readEscrowWorkingBalance, type EscrowJsonRecord } from '../retailer-escrow-transfer.helpers';

class RetailerEscrowReconciliationService {
  private readonly logger = new Logger(RetailerEscrowReconciliationService.name);

  async requestReconciliation(retailerMerchantId?: string): Promise<EscrowJsonRecord> {
    const [deposits, transfers] = await prisma.$transaction(
      async (tx) => Promise.all([
        tx.retailerEscrowFloatDeposit.aggregate({
          where: { status: 'SUCCEEDED', ...(retailerMerchantId ? { retailerMerchantId } : {}) },
          _sum: { amount: true },
        }),
        tx.retailerEscrowTransfer.aggregate({
          where: { status: 'SUCCEEDED', ...(retailerMerchantId ? { retailerMerchantId } : {}) },
          _sum: { amount: true },
        }),
      ]),
      { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
    );
    const expectedBalance = Number(deposits._sum.amount ?? 0) - Number(transfers._sum.amount ?? 0);
    const reconciliation = await prisma.retailerEscrowReconciliation.create({
      data: { expectedBalance, retailerMerchantId: retailerMerchantId ?? null },
    });

    try {
      const response = await retailerEscrowBalanceService.queryBalance(
        `escrow-reconciliation/${reconciliation.id}`,
        `escrow-reconciliation-timeout/${reconciliation.id}`,
        { reconciliationId: reconciliation.id, retailerMerchantId },
      );
      const responseCode = String(response.responseCode ?? response.ResponseCode ?? '');
      if (responseCode !== '0') {
        throw new Error(String(response.responseDescription ?? response.ResponseDescription ?? 'M-Pesa did not accept the escrow reconciliation query'));
      }
      await prisma.retailerEscrowReconciliation.update({
        where: { id: reconciliation.id },
        data: {
          originatorConversationId: String(response.originatorConversationId ?? response.OriginatorConversationID ?? '') || null,
          conversationId: String(response.conversationId ?? response.ConversationID ?? '') || null,
        },
      });
      this.logger.log('[ESCROW_RECONCILIATION][REQUESTED]', {
        reconciliationId: reconciliation.id,
        expectedBalance,
      });
      return { reconciliationId: reconciliation.id, status: 'PENDING', expectedBalance };
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      await prisma.retailerEscrowReconciliation.update({
        where: { id: reconciliation.id },
        data: { status: 'FAILED', failureReason: reason, completedAt: new Date() },
      });
      this.logger.error('[ESCROW_RECONCILIATION][REQUEST_FAILED]', {
        reconciliationId: reconciliation.id,
        expectedBalance,
        error: reason,
      });
      return { reconciliationId: reconciliation.id, status: 'FAILED', expectedBalance, reason };
    }
  }

  async getRetailerBalanceCheck(reconciliationId: string, retailerMerchantId: string): Promise<EscrowJsonRecord> {
    const reconciliation = await prisma.retailerEscrowReconciliation.findFirst({
      where: { id: reconciliationId, retailerMerchantId },
      select: {
        id: true,
        status: true,
        expectedBalance: true,
        observedBalance: true,
        difference: true,
        failureReason: true,
        createdAt: true,
        completedAt: true,
      },
    });
    if (!reconciliation) throw new NotFoundException(`Escrow balance check ${reconciliationId} was not found`);
    return {
      ...reconciliation,
      expectedBalance: Number(reconciliation.expectedBalance),
      observedBalance: reconciliation.observedBalance === null ? null : Number(reconciliation.observedBalance),
      difference: reconciliation.difference === null ? null : Number(reconciliation.difference),
    };
  }

  async handleCallback(reconciliationId: string, body: EscrowJsonRecord): Promise<EscrowJsonRecord> {
    const reconciliation = await prisma.retailerEscrowReconciliation.findUnique({ where: { id: reconciliationId } });
    if (!reconciliation) throw new NotFoundException(`Escrow reconciliation ${reconciliationId} was not found`);
    if (reconciliation.status !== 'PENDING') {
      return { received: true, duplicate: true, status: reconciliation.status };
    }

    const result = getEscrowResult(body);
    const resultCode = String(result.ResultCode ?? result.resultCode ?? '');
    if (resultCode !== '0') {
      const reason = String(result.ResultDesc ?? result.ResultDescription ?? 'M-Pesa escrow reconciliation query failed');
      await this.complete(reconciliationId, {
        status: 'FAILED',
        callbackBody: body as Prisma.InputJsonValue,
        failureReason: reason,
        completedAt: new Date(),
      });
      this.logger.error('[ESCROW_RECONCILIATION][QUERY_FAILED]', { reconciliationId, resultCode, reason });
      return { received: true, accepted: false, status: 'FAILED', reason };
    }

    const observedBalance = readEscrowWorkingBalance(result);
    if (observedBalance === null) {
      const reason = 'M-Pesa escrow reconciliation callback did not contain a parseable Working Account balance';
      await this.complete(reconciliationId, {
        status: 'FAILED',
        callbackBody: body as Prisma.InputJsonValue,
        failureReason: reason,
        completedAt: new Date(),
      });
      return { received: true, accepted: false, status: 'FAILED', reason };
    }

    const expected = Number(reconciliation.expectedBalance);
    const difference = observedBalance - expected;
    const status = Math.abs(difference) < 0.01 ? 'MATCHED' : 'MISMATCH';
    const claimed = await this.complete(reconciliationId, {
      status,
      observedBalance: new Prisma.Decimal(observedBalance),
      difference: new Prisma.Decimal(difference),
      callbackBody: body as Prisma.InputJsonValue,
      failureReason: status === 'MISMATCH'
        ? `Shared escrow balance mismatch: expected ${expected} KES, observed ${observedBalance} KES, difference ${difference} KES`
        : null,
      completedAt: new Date(),
    });
    if (!claimed) {
      return { received: true, duplicate: true, status: 'COMPLETED' };
    }

    if (status === 'MISMATCH') {
      this.logger.error('[ESCROW_RECONCILIATION][MISMATCH]', {
        reconciliationId,
        expectedBalance: expected,
        observedBalance,
        difference,
        action: 'INVESTIGATION_REQUIRED',
      });
    } else {
      this.logger.log('[ESCROW_RECONCILIATION][MATCHED]', { reconciliationId, expectedBalance: expected, observedBalance });
    }
    return { received: true, status, reconciliationId, expectedBalance: expected, observedBalance, difference };
  }

  async handleTimeout(reconciliationId: string, body: EscrowJsonRecord): Promise<EscrowJsonRecord> {
    const reconciliation = await prisma.retailerEscrowReconciliation.findUnique({ where: { id: reconciliationId } });
    if (!reconciliation) throw new NotFoundException(`Escrow reconciliation ${reconciliationId} was not found`);
    if (reconciliation.status !== 'PENDING') return { received: true, duplicate: true, status: reconciliation.status };
    const reason = 'M-Pesa account balance reconciliation query timed out';
    await this.complete(reconciliationId, {
      status: 'FAILED',
      callbackBody: body as Prisma.InputJsonValue,
      failureReason: reason,
      completedAt: new Date(),
    });
    this.logger.error('[ESCROW_RECONCILIATION][TIMEOUT]', { reconciliationId, reason });
    return { received: true, accepted: false, status: 'FAILED', reason };
  }

  async getRecentResults(): Promise<EscrowJsonRecord> {
    const reconciliations = await prisma.retailerEscrowReconciliation.findMany({
      orderBy: { createdAt: 'desc' },
      take: 50,
      select: {
        id: true,
        status: true,
        expectedBalance: true,
        observedBalance: true,
        difference: true,
        failureReason: true,
        createdAt: true,
        completedAt: true,
      },
    });
    return {
      count: reconciliations.length,
      hasMismatch: reconciliations.some((entry) => entry.status === 'MISMATCH'),
      reconciliations: reconciliations.map((entry) => ({
        ...entry,
        expectedBalance: Number(entry.expectedBalance),
        observedBalance: entry.observedBalance === null ? null : Number(entry.observedBalance),
        difference: entry.difference === null ? null : Number(entry.difference),
      })),
    };
  }

  private async complete(reconciliationId: string, data: Prisma.RetailerEscrowReconciliationUpdateInput) {
    const result = await prisma.retailerEscrowReconciliation.updateMany({
      where: { id: reconciliationId, status: 'PENDING' },
      data,
    });
    return result.count === 1;
  }
}

export const retailerEscrowReconciliationService = new RetailerEscrowReconciliationService();