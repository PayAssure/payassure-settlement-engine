import { ConflictException, NotFoundException } from '@nestjs/common';
import { ParticipantType, Prisma } from '@prisma/client';
import { randomUUID } from 'crypto';
import { prisma } from '../../../common/database/prisma';
import { resolveMpesaCallbackUrl } from '../../../payment/config/mpesa.env';
import { MpesaStkOperationsBase } from '../../../payment/services/mpesa-operations/stk-operations.base';
import type { MpesaRequestCredentials } from '../../../payment/services/mpesa-operations/types';
import { parseStkCallback } from '../../../payment/utils/mpesa-callback.util';
import { getRetailerEscrowMpesaConfig } from '../../config/retailer-escrow.env';

class RetailerFloatDepositService extends MpesaStkOperationsBase {
  protected readonly logger = console;

  async initiate(merchantId: string, amount: number, payerPhoneNumber: string) {
    if (!Number.isInteger(amount) || amount <= 0) {
      throw new Error('amount must be a positive integer KES amount');
    }

    const integration = await prisma.integration.findUnique({
      where: { merchantId },
      include: { participant: true },
    });
    if (!integration || integration.participant.participantType !== ParticipantType.RETAILER) {
      throw new NotFoundException(`Retailer integration ${merchantId} was not found`);
    }

    const float = await prisma.retailerEscrowFloat.findUnique({ where: { merchantId } });
    if (!float) {
      throw new NotFoundException(`Escrow float is not configured for retailer ${merchantId}`);
    }

    const config = getRetailerEscrowMpesaConfig();
    const callbackToken = randomUUID();
    const deposit = await prisma.retailerEscrowFloatDeposit.create({
      data: {
        retailerMerchantId: merchantId,
        retailerEscrowFloatId: float.id,
        amount: new Prisma.Decimal(amount),
        payerPhone: this.formatPhoneNumber(payerPhoneNumber),
        callbackToken,
        status: 'PENDING',
      },
    });

    const timestamp = this.generateTimestamp();
    const callbackUrl = resolveMpesaCallbackUrl(config.callbackUrl, `/retailer-float-deposit/${deposit.id}`);
    const payload = {
      BusinessShortCode: config.shortcode,
      Password: this.buildPassword(config.shortcode, config.passkey, timestamp),
      Timestamp: timestamp,
      TransactionType: 'CustomerPayBillOnline',
      Amount: amount,
      PartyA: deposit.payerPhone,
      PartyB: config.shortcode,
      PhoneNumber: deposit.payerPhone,
      CallBackURL: callbackUrl,
      AccountReference: `FLOAT-${deposit.id}`,
      TransactionDesc: `Retailer escrow float deposit ${deposit.id}`,
    };
    const credentials: MpesaRequestCredentials = {
      environment: config.environment,
      consumerKey: config.consumerKey,
      consumerSecret: config.consumerSecret,
    };

    try {
      const response = await this.makeRequest('stk_push', payload, credentials);
      const responseCode = String(response.ResponseCode ?? '');
      const status = responseCode === '0' ? 'SUBMITTED' : 'FAILED';
      await prisma.retailerEscrowFloatDeposit.update({
        where: { id: deposit.id },
        data: {
          merchantRequestId: typeof response.MerchantRequestID === 'string' ? response.MerchantRequestID : null,
          checkoutRequestId: typeof response.CheckoutRequestID === 'string' ? response.CheckoutRequestID : null,
          resultCode: Number(response.ResponseCode ?? -1),
          resultDescription: typeof response.ResponseDescription === 'string' ? response.ResponseDescription : null,
          requestBody: payload as Prisma.InputJsonValue,
          status,
          failureReason: status === 'FAILED' ? String(response.ResponseDescription ?? 'M-Pesa STK request was rejected') : null,
        },
      });
      return {
        depositId: deposit.id,
        merchantId,
        amount,
        payerPhoneNumber: deposit.payerPhone,
        status,
        merchantRequestId: response.MerchantRequestID,
        checkoutRequestId: response.CheckoutRequestID,
        responseCode: response.ResponseCode,
        responseDescription: response.ResponseDescription,
      };
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      await prisma.retailerEscrowFloatDeposit.update({ where: { id: deposit.id }, data: { status: 'FAILED', failureReason: reason } });
      throw error;
    }
  }

  async handleCallback(depositId: string, body: Record<string, unknown>) {
    const callback = parseStkCallback(body);
    const deposit = await prisma.retailerEscrowFloatDeposit.findUnique({ where: { id: depositId } });
    if (!deposit) throw new NotFoundException(`Float deposit ${depositId} was not found`);
    if (deposit.status === 'SUCCEEDED' || deposit.status === 'FAILED') {
      return { received: true, duplicate: true, status: deposit.status };
    }

    const callbackAmount = callback.amount == null ? null : Number(callback.amount);
    if (callback.status !== 'completed' || callback.resultCode !== 0) {
      await prisma.retailerEscrowFloatDeposit.update({
        where: { id: deposit.id },
        data: {
          status: 'FAILED',
          resultCode: callback.resultCode,
          resultDescription: callback.resultDesc,
          failureReason: callback.resultDesc ?? 'M-Pesa float deposit failed',
          callbackBody: body as Prisma.InputJsonValue,
        },
      });
      return { received: true, status: 'FAILED', reason: callback.resultDesc ?? 'M-Pesa float deposit failed' };
    }
    if (callbackAmount !== null && callbackAmount !== Number(deposit.amount)) {
      const reason = `Float deposit amount mismatch: expected ${deposit.amount} KES, received ${callbackAmount} KES`;
      await prisma.retailerEscrowFloatDeposit.update({ where: { id: deposit.id }, data: { status: 'FAILED', failureReason: reason, callbackBody: body as Prisma.InputJsonValue } });
      return { received: true, status: 'FAILED', reason };
    }

    return prisma.$transaction(async (transaction) => {
      const claimed = await transaction.retailerEscrowFloatDeposit.updateMany({
        where: { id: deposit.id, status: { in: ['PENDING', 'SUBMITTED'] } },
        data: {
          status: 'SUCCEEDED',
          resultCode: callback.resultCode,
          resultDescription: callback.resultDesc,
          receiptNumber: callback.receipt,
          callbackBody: body as Prisma.InputJsonValue,
          completedAt: new Date(),
        },
      });
      if (claimed.count !== 1) {
        const current = await transaction.retailerEscrowFloatDeposit.findUniqueOrThrow({ where: { id: deposit.id }, select: { status: true } });
        return { received: true, duplicate: true, status: current.status };
      }
      await transaction.retailerEscrowFloat.update({
        where: { id: deposit.retailerEscrowFloatId },
        data: { expectedRemainingBalance: { increment: deposit.amount } },
      });
      return { received: true, status: 'SUCCEEDED', receiptNumber: callback.receipt };
    });
  }
}

export const retailerFloatDepositService = new RetailerFloatDepositService();