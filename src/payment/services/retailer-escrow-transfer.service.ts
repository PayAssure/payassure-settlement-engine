import { ConflictException, NotFoundException } from '@nestjs/common';
import { Prisma, ParticipantType, SettlementStatus } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { prisma } from '../config/mpesa.env';
import { getRetailerEscrowMpesaConfig } from '../config/mpesa.env';
import { accountBalanceService } from './account-balance.service';
import { mpesaService } from './mpesa.service';
import { retailerEscrowB2bService } from './retailer-escrow-b2b.service';

type JsonRecord = Record<string, unknown>;

class RetailerEscrowTransferService {
  async hasFloatConfig(merchantId: string): Promise<boolean> {
    return Boolean(await prisma.retailerEscrowFloat.findUnique({ where: { merchantId }, select: { id: true } }));
  }

  async getFloat(merchantId: string): Promise<JsonRecord> {
    const config = await prisma.retailerEscrowFloat.findUnique({ where: { merchantId } });
    if (!config) throw new NotFoundException(`Escrow float is not configured for retailer ${merchantId}`);
    return {
      merchantId: config.merchantId,
      currency: config.currency,
      dailyFloat: Number(config.dailyFloat),
      expectedRemainingBalance: Number(config.expectedRemainingBalance),
      updatedAt: config.updatedAt,
    };
  }

  async setFloat(
    merchantId: string,
    dailyFloat: number,
    expectedRemainingBalance?: number,
  ): Promise<JsonRecord> {
    if (!Number.isFinite(dailyFloat) || dailyFloat < 0) {
      throw new Error('dailyFloat must be a non-negative number');
    }
    if (expectedRemainingBalance !== undefined && (!Number.isFinite(expectedRemainingBalance) || expectedRemainingBalance < 0)) {
      throw new Error('expectedRemainingBalance must be a non-negative number');
    }

    const integration = await prisma.integration.findUnique({
      where: { merchantId },
      include: { participant: true },
    });
    if (!integration || integration.participant.participantType !== ParticipantType.RETAILER) {
      throw new NotFoundException(`Retailer integration ${merchantId} was not found`);
    }

    const existing = await prisma.retailerEscrowFloat.findUnique({ where: { merchantId } });
    let config;
    if (existing) {
      const updated = await prisma.retailerEscrowFloat.updateMany({
        where: { id: existing.id, activeTransferId: null },
        data: {
          dailyFloat: new Prisma.Decimal(dailyFloat),
          ...(expectedRemainingBalance === undefined
            ? {}
            : { expectedRemainingBalance: new Prisma.Decimal(expectedRemainingBalance) }),
        },
      });
      if (updated.count !== 1) {
        throw new ConflictException('Cannot edit the float while an escrow transfer is in progress');
      }
      config = await prisma.retailerEscrowFloat.findUniqueOrThrow({ where: { id: existing.id } });
    } else {
      config = await prisma.retailerEscrowFloat.create({
        data: {
          merchantId,
          dailyFloat: new Prisma.Decimal(dailyFloat),
          expectedRemainingBalance: new Prisma.Decimal(expectedRemainingBalance ?? dailyFloat),
        },
      });
    }

    return {
      merchantId: config.merchantId,
      currency: config.currency,
      dailyFloat: Number(config.dailyFloat),
      expectedRemainingBalance: Number(config.expectedRemainingBalance),
      updatedAt: config.updatedAt,
    };
  }

  async startForSettlement(request: {
    settlementId: string;
    merchantTransactionReference: string;
    retailerMerchantId: string;
    cashAmount: number;
    mpesaAmount: number;
    mpesaPayerPhone?: string;
  }): Promise<JsonRecord> {
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
    if (!config) throw new NotFoundException(`Escrow float is not configured for retailer ${request.retailerMerchantId}`);
    getRetailerEscrowMpesaConfig();

    const transferId = randomUUID();
    const created = await prisma.$transaction(async (tx) => {
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
    await this.updateSettlementMetadata(request.settlementId, {
      escrowStatus: 'BALANCE_PENDING',
      transferId: created.id,
      cashAmount: request.cashAmount,
      mpesaAmount: request.mpesaAmount,
    });

    try {
      const response = await accountBalanceService.queryAccountBalance(
        `escrow-balance/${created.id}`,
        `escrow-balance-timeout/${created.id}`,
      );
      if (String(response.responseCode ?? '') !== '0') {
        throw new Error(String(response.responseDescription ?? 'Safaricom did not accept the account balance query'));
      }
      await prisma.retailerEscrowTransfer.update({
        where: { id: created.id },
        data: {
          balanceOriginatorConversationId: String(response.originatorConversationId ?? '') || null,
          balanceConversationId: String(response.conversationId ?? '') || null,
        },
      });
      return {
        transferId: created.id,
        status: 'BALANCE_PENDING',
        balanceRequest: response,
      };
    } catch (error) {
      await this.failTransfer(created.id, error instanceof Error ? error.message : String(error), 'FAILED');
      throw error;
    }
  }

  async handleBalanceCallback(transferId: string, body: JsonRecord): Promise<JsonRecord> {
    const transfer = await prisma.retailerEscrowTransfer.findUnique({ where: { id: transferId } });
    if (!transfer) throw new NotFoundException(`Escrow transfer ${transferId} was not found`);
    if (transfer.status !== 'BALANCE_PENDING') {
      return { received: true, duplicate: true, status: transfer.status };
    }

    const result = this.getResult(body);
    const resultCode = String(result.ResultCode ?? result.resultCode ?? '');
    if (resultCode !== '0') {
      const reason = String(result.ResultDesc ?? result.ResultDescription ?? 'M-Pesa account balance query failed');
      await this.failTransfer(transfer.id, reason, 'FAILED', body);
      return { received: true, accepted: false, reason };
    }

    const observedBalance = this.readWorkingBalance(result);
    if (observedBalance === null) {
      const reason = 'M-Pesa account balance callback did not contain a parseable Working Account balance';
      await this.failTransfer(transfer.id, reason, 'FAILED', body);
      return { received: true, accepted: false, reason };
    }

    const requiredBalance = Number(transfer.requiredBalance);
    const transferAmount = Number(transfer.amount);
    if (observedBalance < requiredBalance) {
      const reason = `Escrow balance tampering detected: expected at least ${requiredBalance} KES, observed ${observedBalance} KES. Top up the escrow account and retry with a new transaction reference.`;
      await this.failTransfer(transfer.id, reason, 'BALANCE_MISMATCH', body, observedBalance);
      return { received: true, accepted: false, reason };
    }
    if (observedBalance < transferAmount) {
      const reason = `Insufficient escrow balance: available ${observedBalance} KES; CASH amount required ${transferAmount} KES.`;
      await this.failTransfer(transfer.id, reason, 'BALANCE_MISMATCH', body, observedBalance);
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
    await this.updateSettlementMetadata(transfer.settlementId, {
      escrowStatus: 'BALANCE_VERIFIED',
      observedBalance,
      requiredBalance,
      cashAmount: transferAmount,
    });

    if (Number(transfer.mpesaAmount) > 0) {
      await prisma.retailerEscrowTransfer.update({
        where: { id: transfer.id },
        data: { status: 'WAITING_FOR_MPESA', mpesaStatus: 'PENDING_CALLBACK' },
      });
      try {
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
        return { received: true, accepted: true, status: 'WAITING_FOR_MPESA', mpesaRequest: payment };
      } catch (error) {
        const reason = error instanceof Error ? error.message : String(error);
        await this.failTransfer(transfer.id, reason, 'FAILED');
        return { received: true, accepted: false, reason };
      }
    }

    return this.dispatchB2bTransfer(transfer.id);
  }

  async handleBalanceTimeout(transferId: string, body: JsonRecord): Promise<JsonRecord> {
    const transfer = await prisma.retailerEscrowTransfer.findUnique({ where: { id: transferId } });
    if (!transfer) throw new NotFoundException(`Escrow transfer ${transferId} was not found`);
    if (transfer.status !== 'BALANCE_PENDING') {
      return { received: true, duplicate: true, status: transfer.status };
    }
    const reason = 'M-Pesa account balance request timed out before a result was received';
    await this.failTransfer(transfer.id, reason, 'FAILED', body);
    return { received: true, accepted: false, status: 'FAILED', reason };
  }

  async handleMpesaFundingCallback(merchantTransactionReference: string, success: boolean): Promise<JsonRecord | null> {
    const transfer = await prisma.retailerEscrowTransfer.findFirst({
      where: { settlement: { is: { merchantTransactionReference } } },
    });
    if (!transfer || transfer.status !== 'WAITING_FOR_MPESA') return null;

    if (!success) {
      const reason = 'M-Pesa STK funding failed; escrow transfer was not dispatched.';
      await this.failTransfer(transfer.id, reason, 'FAILED');
      return { accepted: false, status: 'FAILED', reason };
    }

    await prisma.retailerEscrowTransfer.update({
      where: { id: transfer.id },
      data: { mpesaStatus: 'SUCCESS' },
    });
    await this.updateSettlementMetadata(transfer.settlementId, { mpesaStatus: 'SUCCESS' });
    return this.dispatchB2bTransfer(transfer.id);
  }

  async handleTransferCallback(transferId: string, body: JsonRecord): Promise<JsonRecord> {
    const transfer = await prisma.retailerEscrowTransfer.findUnique({ where: { id: transferId } });
    if (!transfer) throw new NotFoundException(`Escrow transfer ${transferId} was not found`);
    if (transfer.status !== 'TRANSFER_PENDING') {
      return { received: true, duplicate: true, status: transfer.status };
    }

    const result = this.getResult(body);
    const resultCode = String(result.ResultCode ?? result.resultCode ?? '');
    if (resultCode !== '0') {
      const reason = String(result.ResultDesc ?? result.ResultDescription ?? 'M-Pesa escrow B2B transfer failed');
      await this.failTransfer(transfer.id, reason, 'FAILED', body, Number(transfer.observedBalance), 'transfer');
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
      await this.updateSettlementMetadata(current.settlementId, {
        escrowStatus: 'SUCCEEDED',
        cashAmount: Number(current.amount),
        expectedRemainingBalance: nextBalance,
        transferCallback: body,
      }, tx);
    });

    const settlement = await prisma.settlement.findUnique({ where: { id: transfer.settlementId } });
    return {
      received: true,
      accepted: true,
      status: 'SUCCEEDED',
      transferId: transfer.id,
      merchantTransactionReference: settlement?.merchantTransactionReference,
    };
  }

  async handleTransferTimeout(transferId: string, body: JsonRecord): Promise<JsonRecord> {
    const transfer = await prisma.retailerEscrowTransfer.findUnique({ where: { id: transferId } });
    if (!transfer) throw new NotFoundException(`Escrow transfer ${transferId} was not found`);
    if (transfer.status !== 'TRANSFER_PENDING') {
      return { received: true, duplicate: true, status: transfer.status };
    }
    await this.updateSettlementMetadata(transfer.settlementId, {
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

  private async dispatchB2bTransfer(transferId: string): Promise<JsonRecord> {
    const transfer = await prisma.retailerEscrowTransfer.findUniqueOrThrow({ where: { id: transferId } });
    if (transfer.status === 'TRANSFER_PENDING' || transfer.status === 'SUCCEEDED') {
      return { accepted: true, status: transfer.status, transferId };
    }
    if (transfer.status !== 'BALANCE_VERIFIED' && transfer.status !== 'WAITING_FOR_MPESA') {
      return { accepted: false, status: transfer.status, transferId };
    }
    if (Number(transfer.mpesaAmount) > 0 && transfer.mpesaStatus !== 'SUCCESS') {
      return { accepted: true, status: 'WAITING_FOR_MPESA', transferId };
    }

    await prisma.retailerEscrowTransfer.update({ where: { id: transferId }, data: { status: 'TRANSFER_PENDING' } });
    await this.updateSettlementMetadata(transfer.settlementId, { escrowStatus: 'TRANSFER_PENDING' });
    try {
      const settlement = await prisma.settlement.findUniqueOrThrow({ where: { id: transfer.settlementId } });
      const response = await retailerEscrowB2bService.transferToPayAssure({
        amount: Number(transfer.amount),
        merchantTransactionReference: settlement.merchantTransactionReference,
        callbackPath: `escrow-transfer/${transfer.id}`,
        timeoutCallbackPath: `escrow-transfer-timeout/${transfer.id}`,
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
      return { accepted: true, status: 'TRANSFER_PENDING', transferId, transferRequest: response };
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      await this.failTransfer(transferId, reason, 'FAILED');
      return { accepted: false, status: 'FAILED', transferId, reason };
    }
  }

  private async failTransfer(
    transferId: string,
    reason: string,
    status: string,
    callback?: JsonRecord,
    observedBalance?: number,
    callbackType: 'balance' | 'transfer' = 'balance',
  ): Promise<void> {
    await prisma.$transaction(async (tx) => {
      const transfer = await tx.retailerEscrowTransfer.findUnique({ where: { id: transferId } });
      if (!transfer || ['FAILED', 'BALANCE_MISMATCH', 'SUCCEEDED'].includes(transfer.status)) return;
      await tx.retailerEscrowTransfer.update({
        where: { id: transferId },
        data: {
          status,
          failureReason: reason,
          ...(callback && callbackType === 'balance' ? { balanceCallback: callback as Prisma.InputJsonValue } : {}),
          ...(callback && callbackType === 'transfer' ? { transferCallback: callback as Prisma.InputJsonValue } : {}),
          ...(observedBalance === undefined ? {} : { observedBalance: new Prisma.Decimal(observedBalance) }),
        },
      });
      await tx.retailerEscrowFloat.updateMany({
        where: { id: transfer.retailerEscrowFloatId, activeTransferId: transferId },
        data: { activeTransferId: null },
      });
      await this.updateSettlementMetadata(transfer.settlementId, {
        escrowStatus: status,
        escrowFailureReason: reason,
        ...(observedBalance === undefined ? {} : { observedBalance }),
      }, tx, SettlementStatus.FAILED);
    });
  }

  private async updateSettlementMetadata(
    settlementId: string,
    update: JsonRecord,
    tx: any = prisma,
    status?: SettlementStatus,
  ): Promise<void> {
    const settlement = await tx.settlement.findUnique({ where: { id: settlementId } });
    if (!settlement) return;
    const metadata = settlement.metadata && typeof settlement.metadata === 'object' && !Array.isArray(settlement.metadata)
      ? settlement.metadata as JsonRecord
      : {};
    const escrowFunding = metadata.escrowFunding && typeof metadata.escrowFunding === 'object'
      ? metadata.escrowFunding as JsonRecord
      : {};
    await tx.settlement.update({
      where: { id: settlementId },
      data: {
        ...(status ? { status, failedAt: new Date() } : {}),
        metadata: {
          ...metadata,
          escrowFunding: { ...escrowFunding, ...update },
        } as Prisma.InputJsonValue,
      },
    });
  }

  private getResult(body: JsonRecord): JsonRecord {
    const result = body.Result ?? body.result;
    return result && typeof result === 'object' ? result as JsonRecord : body;
  }

  private readWorkingBalance(result: JsonRecord): number | null {
    const parameters = (result.ResultParameters ?? result.resultParameters) as JsonRecord | undefined;
    const rawParameters = parameters?.ResultParameter ?? parameters?.resultParameter;
    const list = Array.isArray(rawParameters) ? rawParameters : [];
    const accountBalance = list.find((parameter) => {
      if (!parameter || typeof parameter !== 'object') return false;
      const entry = parameter as JsonRecord;
      return String(entry.Key ?? entry.key).toLowerCase() === 'accountbalance';
    }) as JsonRecord | undefined;
    const value = accountBalance?.Value ?? accountBalance?.value;
    if (value === undefined || value === null) return null;

    const balanceText = String(value).trim();
    const directValue = Number(balanceText.replace(/,/g, ''));
    if (Number.isFinite(directValue)) return directValue;

    const rows = balanceText.split('&').map((row) => row.split('|').map((part) => part.trim()));
    const workingAccount = rows.find((row) => row[0]?.toLowerCase() === 'working account');
    const candidate = workingAccount?.[workingAccount.length - 1] ?? (rows.length === 1 ? rows[0][rows[0].length - 1] : undefined);
    if (candidate === undefined) return null;
    const parsed = Number(candidate.replace(/,/g, ''));
    return Number.isFinite(parsed) ? parsed : null;
  }
}

export const retailerEscrowTransferService = new RetailerEscrowTransferService();
