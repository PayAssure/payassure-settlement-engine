import { Prisma } from '@prisma/client';
import { randomUUID } from 'crypto';
import { prisma } from '../../../common/database/prisma';
import { getMpesaCallbackUrl } from '../../config/mpesa.env';
import { MpesaRequestBase } from './request.base';

export abstract class MpesaStkOperationsBase extends MpesaRequestBase {
  async initiateStkPush(request: Record<string, any>): Promise<Record<string, unknown>> {
    const env = this.currentEnvironment();
    const timestamp = this.generateTimestamp();
    const shortcode = env.shortcode || '174379';
    const passkey = env.passkey || '';
    const payerPhoneNumber = typeof request.payerPhoneNumber === 'string' ? request.payerPhoneNumber : typeof request.mobileNumber === 'string' ? request.mobileNumber : '';
    const formattedNumber = this.formatPhoneNumber(String(payerPhoneNumber || '').trim());
    const callbackToken = randomUUID();
    const record = await prisma.mpesaTransaction.create({
      data: {
        callbackToken,
        amount: Number(request.amount ?? 0),
        status: 'PENDING',
        businessShortCode: shortcode,
        accountReference: request.accountReference ?? null,
        phoneNumber: formattedNumber,
        settlementId: request.settlementId ?? null,
        merchantTransactionReference: request.merchantTransactionReference ?? null,
        gatewayPayloadJson: request.gatewayPayload ?? null,
        processingLogs: ['STK push initiated', 'waiting for callback'],
      },
    });
    const callbackUrl = getMpesaCallbackUrl(`/${callbackToken}`);
    const payload = {
      BusinessShortCode: shortcode,
      Password: this.buildPassword(shortcode, passkey, timestamp),
      Timestamp: timestamp,
      TransactionType: 'CustomerPayBillOnline',
      Amount: Math.round(Number(request.amount)),
      PartyA: formattedNumber,
      PartyB: shortcode,
      PhoneNumber: formattedNumber,
      CallBackURL: callbackUrl,
      AccountReference: request.accountReference || 'Payassure',
      TransactionDesc: request.transactionDesc || request.description || 'payment for goods',
    };
    try {
      const response = await this.makeRequest('stk_push', payload);
      const responseCode = typeof response.ResponseCode === 'string' ? response.ResponseCode : String(response.ResponseCode ?? '');
      const responseDescription = typeof response.ResponseDescription === 'string' ? response.ResponseDescription : undefined;
      await prisma.mpesaTransaction.update({
        where: { id: record.id },
        data: {
          merchantRequestId: typeof response.MerchantRequestID === 'string' ? response.MerchantRequestID : null,
          checkoutRequestId: typeof response.CheckoutRequestID === 'string' ? response.CheckoutRequestID : null,
          resultCode: Number(response.ResponseCode ?? -1),
          resultDescription: responseDescription ?? null,
          customerMessage: typeof response.CustomerMessage === 'string' ? response.CustomerMessage : null,
          requestBody: payload as Prisma.InputJsonValue,
          status: responseCode === '0' ? 'PENDING' : 'FAILED',
        },
      });
      return {
        merchantRequestId: response.MerchantRequestID,
        checkoutRequestId: response.CheckoutRequestID,
        responseCode: response.ResponseCode,
        responseDescription: response.ResponseDescription,
        customerMessage: response.CustomerMessage,
        timestamp: new Date().toISOString(),
      };
    } catch (error) {
      const failureReason = error instanceof Error ? error.message : String(error);
      await prisma.mpesaTransaction.update({
        where: { id: record.id },
        data: { status: 'FAILED', resultDescription: failureReason, pushFailureReason: failureReason },
      });
      throw error;
    }
  }

  async queryStkStatus(checkoutRequestId: string): Promise<Record<string, unknown>> {
    const env = this.currentEnvironment();
    const timestamp = this.generateTimestamp();
    const shortcode = env.shortcode || '174379';
    const payload = {
      BusinessShortCode: shortcode,
      Password: this.buildPassword(shortcode, env.passkey || '', timestamp),
      Timestamp: timestamp,
      CheckoutRequestID: checkoutRequestId,
    };
    const response = await this.makeRequest('stk_query', payload);
    return {
      merchantRequestId: response.MerchantRequestID,
      checkoutRequestId: response.CheckoutRequestID,
      responseCode: response.ResponseCode,
      responseDescription: response.ResponseDescription,
      resultCode: response.ResultCode,
      resultDesc: response.ResultDesc,
      timestamp: new Date().toISOString(),
    };
  }
}
