import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import { prisma } from '../../common/database/prisma';
import { getRetailerEscrowMpesaConfig, getRetailerEscrowMpesaLogContext } from '../config/retailer-escrow.env';
import { retailerEscrowB2bService } from './transfer/retailer-escrow-b2b.service';
import { retailerEscrowPayoutFlowService } from './transfer/retailer-escrow-payout-flow.service';
import { retailerEscrowBalanceQueryService } from './balance/retailer-escrow-balance-query.service';
import { retailerEscrowFloatService } from './retailer-escrow-float.service';
import { retailerEscrowTransferService } from './transfer/retailer-escrow-transfer.service';

test('retailer escrow credentials use fixed MPESA_RETAILER environment names', () => {
  const names = [
    'MPESA_RETAILER_ENVIRONMENT',
    'MPESA_RETAILER_CONSUMER_KEY',
    'MPESA_RETAILER_CONSUMER_SECRET',
    'MPESA_RETAILER_SHORTCODE',
    'MPESA_RETAILER_PASSKEY',
    'MPESA_RETAILER_PARTY_A',
    'MPESA_RETAILER_INITIATOR_NAME',
    'MPESA_RETAILER_INITIATOR_PASSWORD',
    'MPESA_RETAILER_CALLBACK_URL',
    'MPESA_CONSUMER_KEY',
    'MPESA_CONSUMER_SECRET',
  ];
  const previous = new Map(names.map((name) => [name, process.env[name]]));

  try {
    process.env.MPESA_RETAILER_ENVIRONMENT = 'sandbox';
    process.env.MPESA_RETAILER_CONSUMER_KEY = 'retailer-key';
    process.env.MPESA_RETAILER_CONSUMER_SECRET = 'retailer-secret';
    process.env.MPESA_RETAILER_SHORTCODE = '600001';
    process.env.MPESA_RETAILER_PASSKEY = 'retailer-passkey';
    delete process.env.MPESA_RETAILER_PARTY_A;
    process.env.MPESA_RETAILER_INITIATOR_NAME = 'retailer-initiator';
    process.env.MPESA_RETAILER_INITIATOR_PASSWORD = 'retailer-password';
    process.env.MPESA_RETAILER_CALLBACK_URL = 'https://example.test';
    process.env.MPESA_CONSUMER_KEY = 'shared-key-must-not-be-used';
    process.env.MPESA_CONSUMER_SECRET = 'shared-secret-must-not-be-used';

    const config = getRetailerEscrowMpesaConfig();
    assert.equal(config.consumerKey, 'retailer-key');
    assert.equal(config.consumerSecret, 'retailer-secret');
    assert.equal(config.shortcode, '600001');
    assert.equal(config.partyA, '600001');
    assert.equal(config.environment, 'sandbox');
    const logContext = JSON.stringify(getRetailerEscrowMpesaLogContext(config));
    assert.match(logContext, /MPESA_RETAILER_ENVIRONMENT/);
    assert.match(logContext, /MPESA_RETAILER_SHORTCODE \(fallback\)/);
    assert.match(logContext, /\[REDACTED\]/);
    assert.doesNotMatch(logContext, /retailer-secret|retailer-password|retailer-key/);
  } finally {
    for (const [name, value] of previous) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  }
});

test('retailer escrow balance query uses retailer MPESA credentials and IdentifierType 2', async () => {
  const envNames = [
    'MPESA_RETAILER_CALLBACK_URL',
    'MPESA_RETAILER_ENVIRONMENT',
    'MPESA_RETAILER_CONSUMER_KEY',
    'MPESA_RETAILER_CONSUMER_SECRET',
    'MPESA_RETAILER_SHORTCODE',
    'MPESA_RETAILER_PARTY_A',
    'MPESA_RETAILER_INITIATOR_NAME',
    'MPESA_RETAILER_INITIATOR_PASSWORD',
    'MPESA_CALLBACK_URL',
    'MPESA_CONSUMER_KEY',
    'MPESA_CONSUMER_SECRET',
    'MPESA_SHORTCODE',
    'MPESA_PARTYA',
    'MPESA_INITIATOR_NAME',
    'MPESA_INITIATOR_PASSWORD',
  ];
  const previousEnv = new Map(envNames.map((name) => [name, process.env[name]]));
  const previousMakeRequest = (require('../../payment/services/mpesa.service').mpesaService as any).makeRequest;

  try {
    process.env.MPESA_RETAILER_CALLBACK_URL = 'https://example.test/retailer';
    process.env.MPESA_RETAILER_ENVIRONMENT = 'sandbox';
    process.env.MPESA_RETAILER_CONSUMER_KEY = 'retailer-consumer-key';
    process.env.MPESA_RETAILER_CONSUMER_SECRET = 'retailer-consumer-secret';
    process.env.MPESA_RETAILER_SHORTCODE = '600997';
    delete process.env.MPESA_RETAILER_PARTY_A;
    process.env.MPESA_RETAILER_INITIATOR_NAME = 'retailer-initiator';
    process.env.MPESA_RETAILER_INITIATOR_PASSWORD = 'retailer-password';
    process.env.MPESA_CALLBACK_URL = 'https://example.test/shared';
    process.env.MPESA_CONSUMER_KEY = 'shared-consumer-key';
    process.env.MPESA_CONSUMER_SECRET = 'shared-consumer-secret';
    process.env.MPESA_SHORTCODE = '600998';
    process.env.MPESA_PARTYA = '600999';
    process.env.MPESA_INITIATOR_NAME = 'shared-initiator';
    process.env.MPESA_INITIATOR_PASSWORD = 'shared-password';

    let payload: any;
    let credentials: any;
    (require('../../payment/services/mpesa.service').mpesaService as any).makeRequest = async (_endpoint: string, nextPayload: Record<string, unknown>, nextCredentials?: Record<string, unknown>) => {
      payload = nextPayload;
      credentials = nextCredentials;
      return {
        OriginatorConversationID: 'retailer-ocid',
        ConversationID: 'retailer-cid',
        ResponseCode: '0',
        ResponseDescription: 'Accept the service request successfully',
      };
    };

    const { retailerEscrowBalanceService } = require('./balance/retailer-escrow-balance.service');
    const result = await retailerEscrowBalanceService.queryBalance(
      'retailer-escrow-balance',
      'retailer-escrow-balance-timeout',
    );

    assert.equal(payload.Initiator, 'retailer-initiator');
    assert.equal(payload.IdentifierType, '2');
    assert.equal(payload.PartyA, '600997');
    assert.equal(payload.QueueTimeOutURL, 'https://example.test/retailer/callbacks/mpesa/retailer-escrow-balance-timeout');
    assert.equal(payload.ResultURL, 'https://example.test/retailer/callbacks/mpesa/retailer-escrow-balance');
    assert.equal(credentials.environment, 'sandbox');
    assert.equal(credentials.consumerKey, 'retailer-consumer-key');
    assert.equal(credentials.consumerSecret, 'retailer-consumer-secret');
    assert.equal(result.ResponseCode, '0');
  } finally {
    (require('../../payment/services/mpesa.service').mpesaService as any).makeRequest = previousMakeRequest;
    for (const [name, value] of previousEnv) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  }
});

test('retailer M-Pesa request retries once with the replacement OAuth token when the first token is rejected', async () => {
  const { mpesaService } = require('../../payment/services/mpesa.service');
  const previousFetch = globalThis.fetch;
  const previousLogRequest = mpesaService.logRequest;
  const previousEnvironment = process.env.MPESA_ENVIRONMENT;
  const previousConsumerKey = process.env.MPESA_CONSUMER_KEY;
  const previousConsumerSecret = process.env.MPESA_CONSUMER_SECRET;
  const requests: Array<{ url: string; init?: RequestInit }> = [];

  try {
    process.env.MPESA_ENVIRONMENT = 'sandbox';
    process.env.MPESA_CONSUMER_KEY = 'shared-key-must-not-be-used';
    process.env.MPESA_CONSUMER_SECRET = 'shared-secret-must-not-be-used';
    mpesaService.logRequest = async () => undefined;
    globalThis.fetch = (async (input: unknown, init?: RequestInit) => {
      const url = String(input);
      requests.push({ url, init });
      const body = requests.length === 1
        ? { access_token: 'first-retailer-access-token', expires_in: 3599 }
        : requests.length === 2
          ? { errorCode: '404.001.03', errorMessage: 'Invalid Access Token' }
          : requests.length === 3
            ? { access_token: 'replacement-retailer-access-token', expires_in: 3599 }
            : { ResponseCode: '0', ResponseDescription: 'Accepted' };
      return {
        ok: requests.length !== 2,
        status: requests.length === 2 ? 404 : 200,
        statusText: requests.length === 2 ? 'Not Found' : 'OK',
        text: async () => JSON.stringify(body),
      } as Response;
    }) as typeof fetch;

    await mpesaService.makeRequest('account_balance', { IdentifierType: '2' }, {
      environment: 'production',
      consumerKey: 'retailer-consumer-key',
      consumerSecret: 'retailer-consumer-secret',
    });

    assert.equal(
      requests[0].url,
      'https://api.safaricom.co.ke/oauth/v1/generate?grant_type=client_credentials',
    );
    assert.equal(requests[0].init?.method, 'GET');
    assert.equal(
      (requests[0].init?.headers as Record<string, string>).Authorization,
      `Basic ${Buffer.from('retailer-consumer-key:retailer-consumer-secret').toString('base64')}`,
    );
    assert.equal(requests[1].url, 'https://api.safaricom.co.ke/mpesa/accountbalance/v1/query');
    assert.equal(
      (requests[1].init?.headers as Record<string, string>).Authorization,
      'Bearer first-retailer-access-token',
    );
    assert.equal(
      requests[2].url,
      'https://api.safaricom.co.ke/oauth/v1/generate?grant_type=client_credentials',
    );
    assert.equal(
      requests[3].url,
      'https://api.safaricom.co.ke/mpesa/accountbalance/v1/query',
    );
    assert.equal(
      (requests[3].init?.headers as Record<string, string>).Authorization,
      'Bearer replacement-retailer-access-token',
    );
  } finally {
    globalThis.fetch = previousFetch;
    mpesaService.logRequest = previousLogRequest;
    if (previousEnvironment === undefined) delete process.env.MPESA_ENVIRONMENT;
    else process.env.MPESA_ENVIRONMENT = previousEnvironment;
    if (previousConsumerKey === undefined) delete process.env.MPESA_CONSUMER_KEY;
    else process.env.MPESA_CONSUMER_KEY = previousConsumerKey;
    if (previousConsumerSecret === undefined) delete process.env.MPESA_CONSUMER_SECRET;
    else process.env.MPESA_CONSUMER_SECRET = previousConsumerSecret;
  }
});

test('retailer escrow initiation trusts the tracked remainder and reports the exact shortfall', async () => {
  const originalTransaction = (prisma as any).$transaction;
  const floatModel = (prisma as any).retailerEscrowFloat;
  const transferModel = (prisma as any).retailerEscrowTransfer;
  const settlementModel = (prisma as any).settlement;
  const original = {
    floatFindUnique: floatModel.findUnique,
    floatUpdateMany: floatModel.updateMany,
    transferCreate: transferModel.create,
    settlementFindUnique: settlementModel.findUnique,
    settlementUpdate: settlementModel.update,
    dispatch: retailerEscrowPayoutFlowService.dispatchB2bTransfer,
    getAvailableBalance: retailerEscrowFloatService.getAvailableBalance,
  };
  const float = { id: 'float-ledger-test', activeTransferId: null };
  let locked = false;
  let createdTransfer: any;

  try {
    floatModel.findUnique = async () => float;
    floatModel.updateMany = async ({ where }: any) => {
      assert.equal(where.activeTransferId, null);
      assert.equal('expectedRemainingBalance' in where, false);
      locked = true;
      return { count: 1 };
    };
    transferModel.create = async ({ data }: any) => { createdTransfer = data; return { id: data.id, ...data }; };
    settlementModel.findUnique = async () => ({ metadata: {} });
    settlementModel.update = async () => ({});
    retailerEscrowFloatService.getAvailableBalance = async (floatId: string) => {
      assert.equal(floatId, 'float-ledger-test');
      assert.equal(locked, true, 'the ledger is read only after the retailer lock is acquired');
      return 10000;
    };
    (prisma as any).$transaction = async (callback: (tx: any) => Promise<unknown>) => callback(prisma);
    retailerEscrowPayoutFlowService.dispatchB2bTransfer = async (transferId: string) => {
      return { accepted: true, status: 'TRANSFER_PENDING', transferId };
    };

    const started = await retailerEscrowBalanceQueryService.startForSettlement({
      settlementId: 'settlement-ledger-test',
      merchantTransactionReference: 'TXN-LEDGER-TEST',
      retailerMerchantId: 'retailer-ledger-test',
      cashAmount: 2000,
      mpesaAmount: 0,
    });
    assert.equal(started.status, 'TRANSFER_PENDING');
    assert.equal(locked, true);
    assert.equal(Number(createdTransfer.requiredBalance), 10000);

    await assert.rejects(
      () => retailerEscrowBalanceQueryService.startForSettlement({
        settlementId: 'settlement-short-test',
        merchantTransactionReference: 'TXN-SHORT-TEST',
        retailerMerchantId: 'retailer-ledger-test',
        cashAmount: 11000,
        mpesaAmount: 0,
      }),
      (error: any) => error.response?.message.includes('shortfall 1000 KES'),
    );
  } finally {
    (prisma as any).$transaction = originalTransaction;
    floatModel.findUnique = original.floatFindUnique;
    floatModel.updateMany = original.floatUpdateMany;
    transferModel.create = original.transferCreate;
    settlementModel.findUnique = original.settlementFindUnique;
    settlementModel.update = original.settlementUpdate;
    retailerEscrowPayoutFlowService.dispatchB2bTransfer = original.dispatch;
    retailerEscrowFloatService.getAvailableBalance = original.getAvailableBalance;
  }
});

test('retailer escrow clears the transfer lock only after confirmed B2B callback', async () => {
  const originalTransaction = (prisma as any).$transaction;
  const transferModel = (prisma as any).retailerEscrowTransfer;
  const floatModel = (prisma as any).retailerEscrowFloat;
  const settlementModel = (prisma as any).settlement;
  const originalTransferMethods = {
    findUnique: transferModel.findUnique,
    findUniqueOrThrow: transferModel.findUniqueOrThrow,
    update: transferModel.update,
  };
  const originalFloatMethods = {
    findUniqueOrThrow: floatModel.findUniqueOrThrow,
    update: floatModel.update,
    updateMany: floatModel.updateMany,
  };
  const originalSettlementMethods = {
    findUnique: settlementModel.findUnique,
    findUniqueOrThrow: settlementModel.findUniqueOrThrow,
    update: settlementModel.update,
  };
  const originalB2bTransfer = retailerEscrowB2bService.transferToPayAssure;

  const transfer: Record<string, any> = {
    id: 'transfer-test-1',
    settlementId: 'settlement-test-1',
    retailerEscrowFloatId: 'float-test-1',
    retailerMerchantId: 'pay_retailer_test',
    amount: 200,
    mpesaAmount: 0,
    mpesaStatus: 'NOT_REQUIRED',
    requiredBalance: 800,
    status: 'BALANCE_PENDING',
    observedBalance: null,
  };
  const float = { id: 'float-test-1', activeTransferId: 'transfer-test-1' };
  const settlement = {
    id: 'settlement-test-1',
    merchantTransactionReference: 'TXN-ESCROW-TEST',
    metadata: {},
  };
  let b2bAmount = 0;

  try {
    (prisma as any).$transaction = async (callback: (tx: any) => Promise<unknown>) => callback(prisma);
    transferModel.findUnique = async () => transfer;
    transferModel.findUniqueOrThrow = async () => transfer;
    transferModel.update = async ({ data }: any) => {
      Object.assign(transfer, data);
      return transfer;
    };
    floatModel.findUniqueOrThrow = async () => float;
    floatModel.update = async ({ data }: any) => {
      Object.assign(float, data);
      return float;
    };
    floatModel.updateMany = async () => ({ count: 1 });
    settlementModel.findUnique = async () => settlement;
    settlementModel.findUniqueOrThrow = async () => settlement;
    settlementModel.update = async ({ data }: any) => {
      Object.assign(settlement, data);
      return settlement;
    };
    (retailerEscrowB2bService as any).transferToPayAssure = async (request: any) => {
      b2bAmount = request.amount;
      return { success: true, responseCode: '0', originatorConversationId: 'originator-1' };
    };

    const balanceResult = await retailerEscrowTransferService.handleBalanceCallback('transfer-test-1', {
      Result: {
        ResultCode: 0,
        ResultParameters: {
          ResultParameter: [{
            Key: 'AccountBalance',
            Value: 'Working Account|KES|850.00&Utility Account|KES|0.00',
          }],
        },
      },
    });

    assert.equal(balanceResult.status, 'TRANSFER_PENDING');
    assert.equal(b2bAmount, 200);
    assert.equal(float.activeTransferId, 'transfer-test-1', 'the lock remains while transfer success is unconfirmed');

    const transferResult = await retailerEscrowTransferService.handleTransferCallback('transfer-test-1', {
      Result: { ResultCode: 0, ResultDesc: 'Transfer completed' },
    });

    assert.equal(transferResult.status, 'SUCCEEDED');
    assert.equal(float.activeTransferId, null);
  } finally {
    (prisma as any).$transaction = originalTransaction;
    Object.assign(transferModel, originalTransferMethods);
    Object.assign(floatModel, originalFloatMethods);
    Object.assign(settlementModel, originalSettlementMethods);
    (retailerEscrowB2bService as any).transferToPayAssure = originalB2bTransfer;
  }
});

test('retailer escrow rejects a balance below current expected remainder', async () => {
  const originalTransaction = (prisma as any).$transaction;
  const transferModel = (prisma as any).retailerEscrowTransfer;
  const floatModel = (prisma as any).retailerEscrowFloat;
  const settlementModel = (prisma as any).settlement;
  const originalTransferMethods = {
    findUnique: transferModel.findUnique,
    update: transferModel.update,
  };
  const originalFloatUpdateMany = floatModel.updateMany;
  const originalSettlementMethods = {
    findUnique: settlementModel.findUnique,
    update: settlementModel.update,
  };
  let transferStatus = 'BALANCE_PENDING';
  let releasedActiveTransfer = false;

  try {
    (prisma as any).$transaction = async (callback: (tx: any) => Promise<unknown>) => callback(prisma);
    transferModel.findUnique = async () => ({
      id: 'transfer-test-2',
      settlementId: 'settlement-test-2',
      retailerEscrowFloatId: 'float-test-2',
      amount: 200,
      requiredBalance: 800,
      status: transferStatus,
    });
    transferModel.update = async ({ data }: any) => {
      transferStatus = data.status;
      return {};
    };
    floatModel.updateMany = async () => {
      releasedActiveTransfer = true;
      return { count: 1 };
    };
    settlementModel.findUnique = async () => ({ id: 'settlement-test-2', metadata: {} });
    settlementModel.update = async () => ({});

    const result = await retailerEscrowTransferService.handleBalanceCallback('transfer-test-2', {
      Result: {
        ResultCode: 0,
        ResultParameters: {
          ResultParameter: [{ Key: 'AccountBalance', Value: 'Working Account|KES|799.00' }],
        },
      },
    });

    assert.equal(result.accepted, false);
    assert.match(String(result.reason), /tampering detected/i);
    assert.equal(transferStatus, 'BALANCE_MISMATCH');
    assert.equal(releasedActiveTransfer, true);
  } finally {
    (prisma as any).$transaction = originalTransaction;
    Object.assign(transferModel, originalTransferMethods);
    floatModel.updateMany = originalFloatUpdateMany;
    Object.assign(settlementModel, originalSettlementMethods);
  }
});

test('retailer escrow rejects and releases the float when available balance is below the CASH amount', async () => {
  const originalTransaction = (prisma as any).$transaction;
  const transferModel = (prisma as any).retailerEscrowTransfer;
  const floatModel = (prisma as any).retailerEscrowFloat;
  const settlementModel = (prisma as any).settlement;
  const originalTransferMethods = {
    findUnique: transferModel.findUnique,
    update: transferModel.update,
  };
  const originalFloatUpdateMany = floatModel.updateMany;
  const originalSettlementMethods = {
    findUnique: settlementModel.findUnique,
    update: settlementModel.update,
  };
  const transfer = {
    id: 'transfer-test-insufficient',
    settlementId: 'settlement-test-insufficient',
    retailerEscrowFloatId: 'float-test-insufficient',
    amount: 4000,
    requiredBalance: 800,
    status: 'BALANCE_PENDING',
  };
  let releasedActiveTransfer = false;

  try {
    (prisma as any).$transaction = async (callback: (tx: any) => Promise<unknown>) => callback(prisma);
    transferModel.findUnique = async () => transfer;
    transferModel.update = async ({ data }: any) => {
      Object.assign(transfer, data);
      return transfer;
    };
    floatModel.updateMany = async () => {
      releasedActiveTransfer = true;
      return { count: 1 };
    };
    settlementModel.findUnique = async () => ({ id: transfer.settlementId, metadata: {} });
    settlementModel.update = async () => ({});

    const result = await retailerEscrowTransferService.handleBalanceCallback(transfer.id, {
      Result: {
        ResultCode: 0,
        ResultParameters: {
          ResultParameter: [{ Key: 'AccountBalance', Value: 'Working Account|KES|3500.00' }],
        },
      },
    });

    assert.equal(result.accepted, false);
    assert.match(String(result.reason), /available 3500 KES/i);
    assert.match(String(result.reason), /Top up.*500 KES/i);
    assert.equal(transfer.status, 'BALANCE_MISMATCH');
    assert.equal(releasedActiveTransfer, true);
  } finally {
    (prisma as any).$transaction = originalTransaction;
    Object.assign(transferModel, originalTransferMethods);
    floatModel.updateMany = originalFloatUpdateMany;
    Object.assign(settlementModel, originalSettlementMethods);
  }
});

test('retailer escrow keeps the float locked when the B2B callback outcome is unknown', async () => {
  const transferModel = (prisma as any).retailerEscrowTransfer;
  const settlementModel = (prisma as any).settlement;
  const originalTransferFindUnique = transferModel.findUnique;
  const originalSettlementMethods = {
    findUnique: settlementModel.findUnique,
    update: settlementModel.update,
  };
  const transfer = { id: 'transfer-test-timeout', settlementId: 'settlement-timeout', status: 'TRANSFER_PENDING' };
  const settlement = { id: 'settlement-timeout', metadata: {} as Record<string, any> };

  try {
    transferModel.findUnique = async () => transfer;
    settlementModel.findUnique = async () => settlement;
    settlementModel.update = async ({ data }: any) => {
      Object.assign(settlement, data);
      return settlement;
    };

    const result = await retailerEscrowTransferService.handleTransferTimeout('transfer-test-timeout', {
      Result: { ResultDesc: 'Request timed out' },
    });

    assert.equal(result.status, 'TRANSFER_PENDING');
    assert.equal(result.outcome, 'UNKNOWN');
    assert.equal((settlement.metadata.escrowFunding as any).escrowStatus, 'TRANSFER_OUTCOME_UNKNOWN');
  } finally {
    transferModel.findUnique = originalTransferFindUnique;
    Object.assign(settlementModel, originalSettlementMethods);
  }
});
