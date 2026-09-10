import { Prisma } from '@prisma/client';
import { prisma } from '../config/mpesa.env';
import { parseStkCallback } from '../utils/mpesa-callback.util';

export class PaymentRecordService {
  private extractStoredMerchantTransactionReference(record: Record<string, any> | null | undefined): string | null {
    if (!record) {
      return null;
    }

    const gatewayPayload = record.gatewayPayloadJson as Record<string, any> | undefined;
    const requestBody = record.requestBody as Record<string, any> | undefined;
    const merchantReference =
      (gatewayPayload?.merchantTransactionReference as string | undefined) ??
      (requestBody?.merchantTransactionReference as string | undefined) ??
      (record.merchantTransactionReference as string | undefined) ??
      null;

    return merchantReference || null;
  }

  private extractMerchantTransactionReference(payload: Record<string, unknown>): string | null {
    const gatewayPayload = (payload?.Body as Record<string, unknown> | undefined)?.gatewayPayload as Record<string, unknown> | undefined;
    const merchantReference =
      (gatewayPayload?.merchantTransactionReference as string | undefined) ??
      (payload as Record<string, unknown>).merchantTransactionReference as string | undefined ??
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

    const fallbackMerchantTransactionReference = merchantTransactionReference ?? null;

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

    const resolvedMerchantTransactionReference = this.extractMerchantTransactionReference(payload)
      ?? this.extractStoredMerchantTransactionReference(existingTransaction);

    const existingLogs = Array.isArray(existingTransaction.processingLogs)
      ? existingTransaction.processingLogs
      : [];

    const processingLogEntry = `callback received: status=${parsed.status}, resultCode=${parsed.resultCode}, resultDesc=${parsed.resultDesc}`;
    const lookupLogEntry = resolvedMerchantTransactionReference
      ? `merchant transaction reference resolved from callback lookup: ${resolvedMerchantTransactionReference}`
      : 'merchant transaction reference missing in callback and stored payment record';

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
          merchantTransactionReference: resolvedMerchantTransactionReference ?? existingTransaction.merchantTransactionReference,
          callbackBody: payload as Prisma.InputJsonValue,
          callbackReceivedAt: new Date(),
          processingLogs: [...existingLogs, processingLogEntry, lookupLogEntry, 'callback marked transaction failed'] as Prisma.InputJsonValue,
        },
      });

      return {
        id: updatedTransaction.id,
        checkoutRequestId: updatedTransaction.checkoutRequestId,
        status: updatedTransaction.status,
        merchantTransactionReference: updatedTransaction.merchantTransactionReference ?? resolvedMerchantTransactionReference ?? fallbackMerchantTransactionReference,
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
        merchantTransactionReference: resolvedMerchantTransactionReference ?? existingTransaction.merchantTransactionReference,
        callbackBody: payload as Prisma.InputJsonValue,
        callbackReceivedAt: new Date(),
        processingLogs: [...existingLogs, processingLogEntry, lookupLogEntry, 'callback validated and transaction completed'] as Prisma.InputJsonValue,
      },
    });

    return {
      id: updatedTransaction.id,
      checkoutRequestId: updatedTransaction.checkoutRequestId,
      status: updatedTransaction.status,
      merchantTransactionReference: updatedTransaction.merchantTransactionReference ?? resolvedMerchantTransactionReference ?? fallbackMerchantTransactionReference,
      processingLogs: updatedTransaction.processingLogs,
    };
  }
}

export const paymentRecordService = new PaymentRecordService();
