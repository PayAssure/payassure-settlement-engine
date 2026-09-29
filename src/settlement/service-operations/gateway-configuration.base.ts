import { SettlementRecipientResolutionBase } from './recipient-resolution.base';

export abstract class SettlementGatewayConfigurationBase extends SettlementRecipientResolutionBase {
  protected getB2bPayoutCallbackUrl(callbackIdentifier?: string): string | null {
    const callbackBase = process.env.B2B_PAYOUT_CALLBACK_URL || process.env.PAYMENT_GATEWAY_CALLBACK_URL || process.env.MPESA_CALLBACK_URL;
    if (!callbackBase) return null;
    const normalizedBase = callbackBase.replace(/\/+$/, '');
    const baseWithoutPayments = normalizedBase.replace(/\/payments?$/, '');
    const callbackPath = '/settlement/payouts/callback';
    const callbackSuffix = callbackIdentifier ? `${callbackPath}/${callbackIdentifier}` : callbackPath;
    const callbackUrl = `${baseWithoutPayments}${callbackSuffix}`;
    return normalizedBase.endsWith(callbackSuffix) ? normalizedBase : callbackUrl;
  }

  protected resolvePaymentGatewayCallbackUrl(callbackUrl?: string): string | undefined {
    return callbackUrl ?? process.env.MPESA_CALLBACK_URL ?? process.env.B2B_PAYOUT_CALLBACK_URL ?? process.env.PAYMENT_GATEWAY_CALLBACK_URL;
  }

  protected resolvePayoutGateway(recipientType?: string): 'B2C' | 'B2B' {
    const normalizedType = String(recipientType ?? '').trim().toUpperCase();
    return normalizedType === 'MPESA' ? 'B2C' : 'B2B';
  }
}
