import { Prisma } from '@prisma/client';
import { prisma } from '../config/mpesa.env';
import { parseStkCallback } from '../utils/mpesa-callback.util';

export class PaymentRecordService {
  private extractMerchantTransactionReference(payload: Record<string, unknown>): string | null {
    const gatewayPayload = (payload?.Body as Record<string, unknown> | undefined)?.gatewayPayload as Record<string, unknown> | undefined;
    const merchantReference =
      (gatewayPayload?.merchantTransactionReference as string | undefined) ??
      (payload as Record<string, unknown>).merchantTransactionReference as string | undefined ??
      null;

    return merchantReference || null;
  }

  async upsertFromMpesaCallback(payload: Record<string, unknown>, callbackIdentifier?: string | null): Promise<Record<string, unknown> | null> {
    const parsed = parseStkCallback(payload);

    const searchConditions = [
      callbackIdentifier ? { callbackToken: callbackIdentifier } : undefined,
      callbackIdentifier ? { id: callbackIdentifier } : undefined,
      parsed.checkoutRequestId ? { checkoutRequestId: parsed.checkoutRequestId } : undefined,
      parsed.merchantRequestId ? { merchantRequestId: parsed.merchantRequestId } : undefined,
    ].filter(Boolean) as Array<Record<string, unknown>>;

    const merchantTransactionReference = this.extractMerchantTransactionReference(payload);
    if (merchantTransactionReference) {
      searchConditions.unshift({ merchantTransactionReference });
    }

    if (searchConditions.length === 0) {
      return null;
    }

    const existingTransaction = await prisma.mpesaTransaction.findFirst({
      where: {
        OR: searchConditions,
      },
    });

    if (!existingTransaction) {
      return null;
    }

    const existingLogs = Array.isArray(existingTransaction.processingLogs)
      ? existingTransaction.processingLogs
      : [];

    const processingLogEntry = `callback received: status=${parsed.status}, resultCode=${parsed.resultCode}, resultDesc=${parsed.resultDesc}`;

    if (parsed.status === 'failed') {
      const updatedTransaction = await prisma.mpesaTransaction.update({
        where: { id: existingTransaction.id },
        data: {
          status: 'FAILED',
          callbackConsumed: true,
          merchantRequestId: parsed.merchantRequestId ?? existingTransaction.merchantRequestId,
          receiptNumber: parsed.receipt ?? existingTransaction.receiptNumber,
          resultCode: parsed.resultCode ?? existingTransaction.resultCode,
          resultDescription: parsed.resultDesc ?? existingTransaction.resultDescription,
          callbackBody: payload as Prisma.InputJsonValue,
          callbackReceivedAt: new Date(),
          processingLogs: [...existingLogs, processingLogEntry, 'callback marked transaction failed'] as Prisma.InputJsonValue,
        },
      });

      return {
        id: updatedTransaction.id,
        checkoutRequestId: updatedTransaction.checkoutRequestId,
        status: updatedTransaction.status,
        processingLogs: updatedTransaction.processingLogs,
      };
    }

    const updatedTransaction = await prisma.mpesaTransaction.update({
      where: { id: existingTransaction.id },
      data: {
        status: 'COMPLETED',
        callbackConsumed: true,
        merchantRequestId: parsed.merchantRequestId ?? existingTransaction.merchantRequestId,
        receiptNumber: parsed.receipt ?? existingTransaction.receiptNumber,
        resultCode: parsed.resultCode ?? existingTransaction.resultCode,
        resultDescription: parsed.resultDesc ?? existingTransaction.resultDescription,
        callbackBody: payload as Prisma.InputJsonValue,
        callbackReceivedAt: new Date(),
        processingLogs: [...existingLogs, processingLogEntry, 'callback validated and transaction completed'] as Prisma.InputJsonValue,
      },
    });

    return {
      id: updatedTransaction.id,
      checkoutRequestId: updatedTransaction.checkoutRequestId,
      status: updatedTransaction.status,
      processingLogs: updatedTransaction.processingLogs,
    };
  }
}

export const paymentRecordService = new PaymentRecordService();
