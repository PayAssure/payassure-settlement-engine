import { getMpesaEnv, MPESA_PRODUCTION_ENDPOINTS } from '../../config/mpesa.env';
import { MpesaFormattingBase } from './formatting.base';

export abstract class MpesaEnvironmentBase extends MpesaFormattingBase {
  protected getBaseUrl(environment?: string): string {
    return environment === 'production' ? 'https://api.safaricom.co.ke' : 'https://sandbox.safaricom.co.ke';
  }

  protected getEndpointPath(endpoint: string, environment?: string): string {
    if (environment === 'production') {
      const productionEndpoints: Record<string, string> = {
        stk_push: MPESA_PRODUCTION_ENDPOINTS.stkPush,
        stk_query: MPESA_PRODUCTION_ENDPOINTS.stkPushQuery,
        b2c: MPESA_PRODUCTION_ENDPOINTS.b2c,
        b2b: MPESA_PRODUCTION_ENDPOINTS.b2b,
        b2pochi: '/mpesa/b2pochi/v1/paymentrequest',
        c2b_register: MPESA_PRODUCTION_ENDPOINTS.c2bV1,
        c2b_register_v2: MPESA_PRODUCTION_ENDPOINTS.c2bV2,
        c2b_simulate: MPESA_PRODUCTION_ENDPOINTS.c2bSimulate,
        reversal: MPESA_PRODUCTION_ENDPOINTS.reversal,
        transaction_status: MPESA_PRODUCTION_ENDPOINTS.transactionStatus,
        account_balance: MPESA_PRODUCTION_ENDPOINTS.accountBalance,
        qr_code: MPESA_PRODUCTION_ENDPOINTS.qrCode,
      };
      return productionEndpoints[endpoint] || '';
    }
    const sandboxEndpoints: Record<string, string> = {
      stk_push: '/mpesa/stkpush/v1/processrequest',
      stk_query: '/mpesa/stkpushquery/v1/query',
      b2c: '/mpesa/b2c/v3/paymentrequest',
      b2b: '/mpesa/b2b/v1/paymentrequest',
      b2pochi: '/mpesa/b2pochi/v1/paymentrequest',
      c2b_register: '/mpesa/c2b/v1/registerurl',
      c2b_register_v2: '/mpesa/c2b/v1/registerurl',
      c2b_simulate: '/mpesa/c2b/v1/simulate',
      reversal: '/mpesa/reversal/v1/request',
      transaction_status: '/mpesa/transactionstatus/v1/query',
      account_balance: '/mpesa/accountbalance/v1/query',
      qr_code: '/mpesa/qrcode/v1/generate',
    };
    return sandboxEndpoints[endpoint] || '';
  }

  protected currentEnvironment() {
    return getMpesaEnv();
  }
}
