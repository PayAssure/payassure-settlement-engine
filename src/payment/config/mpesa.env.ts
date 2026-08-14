import { PrismaClient } from '@prisma/client';

export interface MpesaEnvConfig {
  environment?: string;
  consumerKey?: string;
  consumerSecret?: string;
  shortcode?: string;
  partyA?: string;
  passkey?: string;
  initiatorName?: string;
  initiatorPassword?: string;
  securityCredential?: string;
  callbackUrl?: string;
}

/**
 * Production M-Pesa API Endpoints from Safaricom
 * Source: Official Safaricom production credentials email
 */
export const MPESA_PRODUCTION_ENDPOINTS = {
  oauth: '/oauth/v1/generate',
  stkPush: '/mpesa/stkpush/v1/processrequest',
  stkPushQuery: '/mpesa/stkpushquery/v1/query',
  b2c: '/mpesa/b2c/v1/paymentrequest',
  b2b: '/mpesa/b2b/v1/paymentrequest',
  c2bV1: '/mpesa/c2b/v1/registerurl',
  c2bV2: '/mpesa/c2b/v2/registerurl',
  c2bSimulate: '/mpesa/c2b/v1/simulate',
  reversal: '/mpesa/reversal/v1/request',
  transactionStatus: '/mpesa/transactionstatus/v1/query',
  accountBalance: '/mpesa/accountbalance/v1/query',
  qrCode: '/mpesa/qrcode/v1/generate',
  billManager: {
    optIn: '/v1/billmanager-invoice/v1/billmanager-invoice/optin',
    singleInvoicing: '/v1/billmanager-invoice/v1/billmanager-invoice/single-invoicing',
    bulkInvoicing: '/v1/billmanager-invoice/v1/billmanager-invoice/bulk-invoicing',
    reconciliation: '/v1/billmanager-invoice/v1/billmanager-invoice/reconciliation',
    cancelSingleInvoice: '/v1/billmanager-invoice/v1/billmanager-invoice/cancel-single-invoice',
    cancelBulkInvoice: '/v1/billmanager-invoice/v1/billmanager-invoice/cancel-bulk-invoice',
    updateOnboarding: '/v1/billmanager-invoice/v1/billmanager-invoice/change-optin-details',
    updateSingleInvoice: '/v1/billmanager-invoice/v1/billmanager-invoice/change-invoice',
    updateBulkInvoice: '/v1/billmanager-invoice/v1/billmanager-invoice/change-invoices',
  },
};

declare global {
  var prisma: PrismaClient | undefined;
}

export const getMpesaEnv = (): MpesaEnvConfig => ({
  environment: process.env.MPESA_ENVIRONMENT,
  consumerKey: process.env.MPESA_CONSUMER_KEY,
  consumerSecret: process.env.MPESA_CONSUMER_SECRET,
  shortcode: process.env.MPESA_SHORTCODE,
  partyA: process.env.MPESA_PARTYA,
  passkey: process.env.MPESA_PASSKEY,
  initiatorName: process.env.MPESA_INITIATOR_NAME,
  initiatorPassword: process.env.MPESA_INITIATOR_PASSWORD,
  securityCredential: process.env.MPESA_SECURITY_CREDENTIAL,
  callbackUrl: process.env.MPESA_CALLBACK_URL,
});

export const prisma = global.prisma ?? new PrismaClient();

if (process.env.NODE_ENV !== 'production') {
  global.prisma = prisma;
}
