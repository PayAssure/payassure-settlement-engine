import { SettlementGatewayConfigurationBase } from './gateway-configuration.base';
import { b2bService } from '../../payment/services/b2b.service';
import { b2cService } from '../../payment/services/b2c.service';
import type { B2bGatewayResponse } from './types';

export abstract class SettlementGatewayRequestBase extends SettlementGatewayConfigurationBase {
  protected async sendB2bGatewayPayoutRequest(payload: Record<string, any>): Promise<B2bGatewayResponse> {
    const payoutMetadata = (payload.metadata && typeof payload.metadata === 'object' && !Array.isArray(payload.metadata)) ? payload.metadata as Record<string, any> : {};
    const payoutPayment = (payoutMetadata.payment && typeof payoutMetadata.payment === 'object' && !Array.isArray(payoutMetadata.payment))
      ? payoutMetadata.payment as Record<string, any>
      : ((payload.payment && typeof payload.payment === 'object' && !Array.isArray(payload.payment)) ? payload.payment as Record<string, any> : {});
    const recipientPhoneNumber = payload.recipientPhoneNumber ?? payoutPayment.phoneNumber ?? payoutPayment.payerPhoneNumber ?? null;
    const recipientType = String(payload.recipientType ?? payoutPayment.type ?? (recipientPhoneNumber ? 'MPESA' : 'BANK')).trim().toUpperCase();
    const resolvedRecipientType = recipientType === 'MPESA' || recipientType === 'BANK' ? recipientType : (recipientPhoneNumber ? 'MPESA' : 'BANK');
    const callbackUrl = this.resolvePaymentGatewayCallbackUrl(payload.callbackUrl);
    try {
      if (resolvedRecipientType === 'MPESA') {
        const partyB = payload.recipientPhoneNumber ?? payload.phoneNumber ?? payload.payerPhoneNumber ?? payload.metadata?.payment?.phoneNumber ?? payload.metadata?.payment?.payerPhoneNumber ?? payload.recipientShortCode ?? '';
        const request = {
          OriginatorConversationID: payload.reference ?? payload.merchantTransactionReference ?? `${Date.now()}_b2c_${Math.random().toString(36).slice(2, 10)}`,
          CommandID: 'BusinessPayment',
          Amount: String(Number(payload.amount ?? 0)),
          PartyB: partyB,
          Remarks: payload.remarks ?? payload.description ?? `B2C payout to ${payload.party ?? 'recipient'}`,
          QueueTimeOutURL: callbackUrl,
          ResultURL: callbackUrl,
          Occassion: payload.description ?? payload.remarks ?? `B2C payout to ${payload.party ?? 'recipient'}`,
        };
        const response = await b2cService.initiateB2C(request as Record<string, any>);
        const responseCode = response?.responseCode ?? response?.ResponseCode ?? 'UNKNOWN';
        const responseDescription = response?.responseDescription ?? response?.ResponseDescription ?? 'Unknown B2C gateway response';
        return {
          success: String(responseCode) === '0',
          statusCode: 200,
          responseCode: String(responseCode),
          responseDescription: String(responseDescription),
          response,
        };
      }
      const response = await b2bService.initiateB2B({
        recipientShortCode: payload.recipientShortCode ?? payload.recipientPhoneNumber ?? '174379',
        amount: Number(payload.amount ?? 0),
        description: payload.description ?? payload.remarks ?? 'Settlement payout',
        accountReference: payload.accountReference ?? 'B2B Payment',
        callbackUrl,
      });
      const responseCode = response?.responseCode ?? response?.ResponseCode ?? 'UNKNOWN';
      const responseDescription = response?.responseDescription ?? response?.ResponseDescription ?? 'Unknown B2B gateway response';
      return {
        success: String(responseCode) === '0',
        statusCode: 200,
        responseCode: String(responseCode),
        responseDescription: String(responseDescription),
        response,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const errorStack = error instanceof Error ? error.stack : undefined;
      this.logger.error('[B2B][DISPATCH] external payment gateway request failed', {
        recipientType,
        selectedGateway: this.resolvePayoutGateway(resolvedRecipientType),
        error: message,
        errorStack,
        payloadSummary: {
          amount: payload.amount,
          recipientShortCode: payload.recipientShortCode ?? payload.recipientPhoneNumber,
          accountReference: payload.accountReference,
          callbackUrl: payload.callbackUrl,
        },
        timestamp: new Date().toISOString(),
        troubleshooting: {
          checkMpesaEnvironment: process.env.MPESA_ENVIRONMENT || 'not set (defaults to sandbox)',
          checkInitiatorName: process.env.MPESA_INITIATOR_NAME || 'not set (defaults to testapi)',
          checkConsumerKeySet: !!process.env.MPESA_CONSUMER_KEY,
          checkConsumerSecretSet: !!process.env.MPESA_CONSUMER_SECRET,
        },
      });
      return { success: false, error: message };
    }
  }
}
