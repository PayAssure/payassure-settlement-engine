import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import { SettlementService } from './settlement.service';
import { SettlementRecordRepository } from './repository/settlement/settlement.repository';
import { paymentRecordService } from '../payment/services/payment-record.service';
import { prisma } from '../payment/config/mpesa.env';
import { b2bService } from '../payment/services/b2b.service';
import { b2pochiService } from '../payment/services/b2pochi.service';

test('SettlementRecordRepository resolves callback identifiers stored under nested payout request metadata', async () => {
  const callbackIdentifier = '50e1f407-fd08-4640-930d-9718930dc29b';
  const repository = new SettlementRecordRepository({
    settlement: {
      findMany: async () => [{
        id: 'settlement-lookup-nested',
        metadata: {
          payoutDispatches: [{
            requestPayload: {
              metadata: {
                callbackIdentifier,
                callbackToken: callbackIdentifier,
              },
            },
          }],
        },
        transactions: [],
      }],
    },
  } as any);

  const settlement = await repository.findSettlementByPayoutCallbackIdentifier(callbackIdentifier);

  assert.equal(settlement?.id, 'settlement-lookup-nested');
});

test('resolveB2bRecipient resolves retailer payout details from the retailer merchant ID, not the settlement ID', async () => {
  const repository = {
    findIntegrationByMerchantId: async (merchantId: string) => {
      assert.equal(merchantId, 'pay_4bec11e5a382fe7c');
      return {
        participant: {
          payment: {
            type: 'BANK',
            provider: 'Safaricom',
            shortcode: '600000',
            accountName: 'John Doe',
          },
        },
      };
    },
  };

  const service = new SettlementService(repository as any);
  (service as any).prisma = {
    onboardingParticipant: {
      findUnique: async () => {
        throw new Error('should not look up retailer payment by settlement businessId when merchantId is present');
      },
    },
  };

  const recipient = await (service as any).resolveB2bRecipient({
    id: 'settlement-99',
    businessId: 'settlement-99',
    metadata: { retailerMerchantId: 'pay_4bec11e5a382fe7c' },
  }, 'RETAILER');

  assert.equal(recipient.type, 'BANK');
  assert.equal(recipient.shortcode, '600000');
  assert.equal(recipient.accountName, 'John Doe');
});

test('dispatchB2bPayouts routes a retailer MPESA payout through B2Pochi based on the participant payment type', async () => {
  let b2PochiCalled = false;
  let b2bCalled = false;

  const originalB2Pochi = b2pochiService.initiateB2Pochi.bind(b2pochiService);
  const originalB2B = b2bService.initiateB2B.bind(b2bService);

  (b2pochiService as any).initiateB2Pochi = async () => {
    b2PochiCalled = true;
    return { responseCode: '0', responseDescription: 'Accepted' };
  };
  (b2bService as any).initiateB2B = async () => {
    b2bCalled = true;
    return { responseCode: '0', responseDescription: 'Accepted' };
  };

  const repository = {
    findSettlementByReference: async () => ({
      id: 'settlement-retailer-mpesa',
      status: 'PENDING_PROCESSING',
      businessId: 'retailer-1',
      metadata: {
        retailerMerchantId: 'pay_retailer_mpesa',
        paymentCallback: { status: 'SUCCESS', merchantTransactionReference: 'TXN-RETAILER-MPESA' },
      },
      paymentPayload: {
        merchantId: 'pay_retailer_mpesa',
      },
      merchantTransactionReference: 'TXN-RETAILER-MPESA',
      reference: 'REF-RETAILER-MPESA',
      currency: 'KES',
      amount: 1000,
    }),
    findIntegrationByMerchantId: async (merchantId: string) => {
      if (merchantId === 'pay_retailer_mpesa') {
        return {
          participant: {
            payment: {
              type: 'MPESA',
              provider: 'Safaricom',
              phoneNumber: '254712345678',
              payerPhoneNumber: '254712345678',
            },
          },
        };
      }
      return null;
    },
    updateSettlementStatus: async () => ({ id: 'settlement-retailer-mpesa' }),
  };

  const service = new SettlementService(repository as any);
  (service as any).logger = { log: () => {}, warn: () => {}, error: () => {} };
  (service as any).getB2bGatewayBaseUrl = async () => 'https://gateway.example.com';
  (service as any).getB2bGatewayApiToken = () => 'token';

  try {
    const result = await service.dispatchB2bPayouts({
      merchantTransactionReference: 'TXN-RETAILER-MPESA',
      party: 'RETAILER',
      amount: 1000,
    } as any);

    assert.equal(result.success, true);
    assert.equal(b2PochiCalled, true);
    assert.equal(b2bCalled, false);
  } finally {
    (b2pochiService as any).initiateB2Pochi = originalB2Pochi;
    (b2bService as any).initiateB2B = originalB2B;
  }
});

test('dispatchB2bPayouts preserves the payout callback identifier path instead of appending /callbacks/mpesa', async () => {
  const repository = {
    findSettlementByReference: async () => ({
      id: 'settlement-callback-path-1',
      status: 'PENDING_PROCESSING',
      businessId: 'retailer-1',
      metadata: {},
      paymentPayload: {
        merchantId: 'pay_merchant_123',
      },
      merchantTransactionReference: 'TXN-CALLBACK-PATH',
      reference: 'REF-CALLBACK-PATH',
      currency: 'KES',
      amount: 1000,
    }),
    findIntegrationByMerchantId: async () => ({
      participant: {
        payment: {
          type: 'BANK',
          provider: 'Safaricom',
          shortcode: '600000',
          accountName: 'Jane Retailer',
        },
      },
    }),
    updateSettlementStatus: async () => ({ id: 'settlement-callback-path-1' }),
  };

  const service = new SettlementService(repository as any);
  (service as any).logger = { log: () => {}, warn: () => {}, error: () => {} };
  (service as any).getB2bGatewayBaseUrl = async () => 'https://gateway.example.com';
  (service as any).getB2bGatewayApiToken = () => 'token';

  const originalInitiateB2B = b2bService.initiateB2B.bind(b2bService);
  (b2bService as any).initiateB2B = async (request: any) => {
    assert.match(request.callbackUrl, /\/settlement\/payouts\/callback\/[a-f0-9-]+$/i);
    assert.doesNotMatch(request.callbackUrl, /\/callbacks\/mpesa$/);
    return {
      success: true,
      statusCode: 200,
      responseCode: '0',
      responseDescription: 'Accepted',
      response: { accepted: true },
    };
  };

  try {
    const result = await service.dispatchB2bPayouts({
      merchantTransactionReference: 'TXN-CALLBACK-PATH',
      party: 'RETAILER',
      amount: 100,
    });

    assert.equal(result.success, true);
  } finally {
    (b2bService as any).initiateB2B = originalInitiateB2B;
  }
});

test('dispatchB2bPayouts prefers the authenticated retailer integration over stale settlement metadata', async () => {
  const repository = {
    findSettlementByReference: async () => ({
      id: 'settlement-merchant-map-1',
      status: 'PENDING_PROCESSING',
      businessId: 'cmr0ejumw0001f3nqvdke729y',
      metadata: {
        retailerMerchantId: 'pay_stale_merchant',
      },
      paymentPayload: {
        merchantId: 'pay_stale_merchant',
      },
      merchantTransactionReference: 'TXN-MERCHANT-MAP',
      reference: 'REF-MERCHANT-MAP',
      currency: 'KES',
      amount: 1000,
    }),
    findIntegrationByParticipantId: async (participantId: string) => {
      assert.equal(participantId, 'cmr0ejumw0001f3nqvdke729y');
      return {
        merchantId: 'pay_authenticated_merchant',
      };
    },
    findIntegrationByMerchantId: async (merchantId: string) => {
      assert.equal(merchantId, 'pay_authenticated_merchant');
      return {
        participant: {
          payment: {
            type: 'BANK',
            provider: 'Safaricom',
            shortcode: '600000',
            accountName: 'Jane Retailer',
          },
        },
      };
    },
    updateSettlementStatus: async (_id: string, _status: string, updates: any) => ({
      id: 'settlement-merchant-map-1',
      ...updates,
    }),
  };

  const service = new SettlementService(repository as any);
  (service as any).logger = { log: () => {}, warn: () => {}, error: () => {} };
  (service as any).getB2bGatewayBaseUrl = async () => 'https://gateway.example.com';
  (service as any).getB2bGatewayApiToken = () => 'token';
  (service as any).prisma = {
    integration: {
      findFirst: async ({ where }: any) => {
        assert.equal(where.participantId, 'cmr0ejumw0001f3nqvdke729y');
        return {
          merchantId: 'pay_authenticated_merchant',
          participantId: 'cmr0ejumw0001f3nqvdke729y',
          participant: { participantType: 'RETAILER' },
        };
      },
    },
  };
  (service as any).sendB2bGatewayPayoutRequest = async (payload: any) => {
    assert.equal(payload.metadata.retailerMerchantId, 'pay_authenticated_merchant');
    assert.notEqual(payload.metadata.retailerMerchantId, 'pay_stale_merchant');
    return {
      success: true,
      statusCode: 200,
      responseCode: '0',
      responseDescription: 'Accepted',
      response: { accepted: true },
    };
  };

  const result = await service.dispatchB2bPayouts({
    merchantTransactionReference: 'TXN-MERCHANT-MAP',
    party: 'RETAILER',
    amount: 100,
  });

  assert.equal(result.success, true);
  assert.equal(result.dispatchRecord.requestPayload.metadata.retailerMerchantId, 'pay_authenticated_merchant');
});

test('dispatchB2bPayouts routes MPESA payouts through B2Pochi and BANK payouts through B2B', async () => {
  const repository = {
    findSettlementByReference: async () => ({
      id: 'settlement-route-selection-1',
      status: 'PENDING_PROCESSING',
      businessId: 'retailer-1',
      metadata: {},
      paymentPayload: {
        merchantId: 'pay_merchant_456',
      },
      merchantTransactionReference: 'TXN-ROUTE-SELECTION',
      reference: 'REF-ROUTE-SELECTION',
      currency: 'KES',
      amount: 1000,
    }),
    findIntegrationByMerchantId: async (merchantId: string) => {
      if (merchantId === 'pay_merchant_456') {
        return {
          participant: {
            payment: {
              type: 'MPESA',
              provider: 'Safaricom',
              payerPhoneNumber: '+254700000123',
            },
          },
        };
      }
      return null;
    },
    updateSettlementStatus: async () => ({ id: 'settlement-route-selection-1' }),
  };

  const service = new SettlementService(repository as any);
  (service as any).logger = { log: () => {}, warn: () => {}, error: () => {} };
  (service as any).getB2bGatewayBaseUrl = async () => 'https://gateway.example.com';
  (service as any).getB2bGatewayApiToken = () => 'token';

  const originalB2B = b2bService.initiateB2B.bind(b2bService);
  const originalB2Pochi = (await import('../payment/services/b2pochi.service')).b2pochiService.initiateB2Pochi.bind((await import('../payment/services/b2pochi.service')).b2pochiService);

  let b2PochiCalled = false;
  let b2BCalled = false;

  (b2bService as any).initiateB2B = async () => {
    b2BCalled = true;
    return { success: true, statusCode: 200, responseCode: '0', responseDescription: 'Accepted', response: { accepted: true } };
  };
  (await import('../payment/services/b2pochi.service')).b2pochiService.initiateB2Pochi = async (request: any) => {
    b2PochiCalled = true;
    assert.equal(request.PartyB, '+254700000123');
    return { success: true, responseCode: '0', responseDescription: 'Accepted', originatorConversationId: 'oc-1', conversationId: 'c-1' };
  };

  try {
    const result = await service.dispatchB2bPayouts({
      merchantTransactionReference: 'TXN-ROUTE-SELECTION',
      party: 'RETAILER',
      amount: 100,
    });

    assert.equal(result.success, true);
    assert.equal(b2PochiCalled, true);
    assert.equal(b2BCalled, false);
  } finally {
    (b2bService as any).initiateB2B = originalB2B;
    (await import('../payment/services/b2pochi.service')).b2pochiService.initiateB2Pochi = originalB2Pochi;
  }
});

test('dispatchB2bPayouts ignores customer payer MPESA and uses supplier bank payout details when routing recipient funds', async () => {
  const repository = {
    findSettlementByReference: async () => ({
      id: 'settlement-route-selection-supplier-bank',
      status: 'PENDING_PROCESSING',
      businessId: 'retailer-1',
      metadata: {
        retailerMerchantId: 'pay_retailer_123',
      },
      paymentPayload: {
        merchantId: 'pay_retailer_123',
        paymentMethod: {
          type: 'MPESA',
          provider: 'Safaricom',
          payerPhoneNumber: '254700000111',
        },
      },
      merchantTransactionReference: 'TXN-SUPPLIER-BANK-ROUTE',
      reference: 'REF-SUPPLIER-BANK-ROUTE',
      currency: 'KES',
      amount: 1000,
    }),
    findIntegrationByMerchantId: async (merchantId: string) => {
      if (merchantId === 'pay_retailer_123') {
        return {
          participant: {
            payment: {
              type: 'BANK',
              provider: 'Safaricom',
              shortcode: '600000',
              accountName: 'Retailer Merchant',
            },
          },
        };
      }
      if (merchantId === 'pay_supplier_456') {
        return {
          participant: {
            payment: {
              type: 'BANK',
              provider: 'Safaricom',
              shortcode: '600000',
              accountName: 'Supplier Merchant',
            },
          },
        };
      }
      return null;
    },
    updateSettlementStatus: async () => ({ id: 'settlement-route-selection-supplier-bank' }),
  };

  const service = new SettlementService(repository as any);
  (service as any).logger = { log: () => {}, warn: () => {}, error: () => {} };
  (service as any).getB2bGatewayBaseUrl = async () => 'https://gateway.example.com';
  (service as any).getB2bGatewayApiToken = () => 'token';

  const originalB2B = b2bService.initiateB2B.bind(b2bService);
  const originalB2Pochi = (await import('../payment/services/b2pochi.service')).b2pochiService.initiateB2Pochi.bind((await import('../payment/services/b2pochi.service')).b2pochiService);

  let b2PochiCalled = false;
  let b2BCalled = false;

  (b2bService as any).initiateB2B = async (request: any) => {
    b2BCalled = true;
    assert.equal(request.recipientShortCode, '600000');
    assert.equal(request.accountReference, 'Retailer Merchant');
    return { success: true, statusCode: 200, responseCode: '0', responseDescription: 'Accepted', response: { accepted: true } };
  };
  (await import('../payment/services/b2pochi.service')).b2pochiService.initiateB2Pochi = async () => {
    b2PochiCalled = true;
    throw new Error('B2Pochi should not be used when the recipient payout destination is BANK');
  };

  try {
    const result = await service.dispatchB2bPayouts({
      merchantTransactionReference: 'TXN-SUPPLIER-BANK-ROUTE',
      party: 'RETAILER',
      amount: 100,
    });

    assert.equal(result.success, true);
    assert.equal(b2BCalled, true);
    assert.equal(b2PochiCalled, false);
  } finally {
    (b2bService as any).initiateB2B = originalB2B;
    (await import('../payment/services/b2pochi.service')).b2pochiService.initiateB2Pochi = originalB2Pochi;
  }
});

test('dispatchB2bPayouts prefers the child settlement when it already has a successful payment callback', async () => {
  const repository = {
    findSettlementByReference: async () => ({
      id: 'child-settlement-confirmed',
      status: 'INITIATED',
      businessId: 'retailer-1',
      merchantTransactionReference: 'MTXN-CHILD-CONFIRMED-pay_merchant_123',
      reference: 'REF-CHILD-CONFIRMED',
      currency: 'KES',
      amount: 100,
      metadata: {
        parentSettlementId: 'parent-settlement-confirmed',
        paymentCallback: { status: 'SUCCESS', provider: 'M-PESA', providerReference: 'RCP-123' },
      },
      paymentPayload: {
        merchantId: 'pay_merchant_123',
      },
    }),
    findSettlementById: async (id: string) => {
      if (id === 'parent-settlement-confirmed') {
        return {
          id: 'parent-settlement-confirmed',
          status: 'INITIATED',
          businessId: 'retailer-1',
          merchantTransactionReference: 'MTXN-PARENT-CONFIRMED',
          reference: 'REF-PARENT-CONFIRMED',
          currency: 'KES',
          amount: 100,
          metadata: {},
        };
      }
      return null;
    },
    findIntegrationByMerchantId: async () => ({
      participant: {
        payment: {
          type: 'BANK',
          provider: 'Safaricom',
          shortcode: '600000',
          accountName: 'Retailer Merchant',
        },
      },
    }),
    updateSettlementStatus: async () => ({ id: 'child-settlement-confirmed' }),
  };

  const service = new SettlementService(repository as any);
  (service as any).logger = { log: () => {}, warn: () => {}, error: () => {} };
  (service as any).getB2bGatewayBaseUrl = async () => 'https://gateway.example.com';
  (service as any).getB2bGatewayApiToken = () => 'token';
  (service as any).sendB2bGatewayPayoutRequest = async () => ({
    success: true,
    statusCode: 200,
    responseCode: '0',
    responseDescription: 'Accepted',
    response: { accepted: true },
  });

  const result = await service.dispatchB2bPayouts({
    merchantTransactionReference: 'MTXN-CHILD-CONFIRMED-pay_merchant_123',
    party: 'RETAILER',
    amount: 100,
  });

  assert.equal(result.success, true);
  assert.equal(result.status, 'SUBMITTED');
});

test('splitAndAllocateFunds persists payment callback metadata before B2B payout dispatch', async () => {
  let updatedStatus: any = null;
  let updatedMetadata: any = null;

  const repository = {
    findSettlementByReference: async () => ({
      id: 'settlement-split-1',
      status: 'INITIATED',
      metadata: {},
      paymentSnapshot: { type: 'BANK', shortcode: '12345', accountName: 'ACCT NAME' },
      processedAt: null,
      amount: '2',
      businessId: 'retailer-1',
      currency: 'KES',
      reference: 'REF-SPLIT-1',
      paymentPayload: {
        merchantTransactionReference: 'TXN-SPLIT-1',
        paymentMethod: {
          type: 'MPESA',
          provider: 'Safaricom',
          payerPhoneNumber: '+254700000003',
        },
        suppliers: [{ supplierMerchantId: 'SUP-3001', supplierTotalAmount: 1, retailerTotalAmount: 1, platformFee: 0 }],
      },
    }),
    updateSettlementStatus: async (_id: string, status: string, updates: any) => {
      updatedStatus = status;
      updatedMetadata = updates.metadata;
      return { id: 'settlement-split-1', status, ...updates };
    },
  };

  const service = new SettlementService(repository as any);
  let dispatchCalled = false;
  (service as any).dispatchB2bPayouts = async () => {
    dispatchCalled = true;
    if (!updatedMetadata?.paymentCallback?.status || updatedMetadata.paymentCallback.status !== 'SUCCESS') {
      throw new Error('payment callback metadata missing before B2B dispatch');
    }
    return { success: true, status: 'SUBMITTED', payoutReference: 'payout-3001' };
  };

  const response = await service.splitAndAllocateFunds({
    merchantTransactionReference: 'TXN-SPLIT-1',
    mpesaReceipt: 'RCP-3001',
    mpesaCheckoutRequestId: 'checkout-3001',
    mpesaMerchantRequestId: 'merchant-3001',
    resultCode: 0,
    resultDesc: 'The service request is processed successfully.',
  } as any);

  assert.equal(response.success, true);
  assert.equal(dispatchCalled, true);
  assert.equal(updatedMetadata.paymentCallback.status, 'SUCCESS');
  assert.equal(updatedMetadata.paymentCallback.providerReference, 'RCP-3001');
});

test('handlePaymentCallback transitions a settlement into pending processing using participant payout records instead of payer payload details', async () => {
  let updatedStatus: any = null;
  let updatedPayload: any = null;

  const repository = {
    findSettlementByReference: async () => ({
      id: 'settlement-1',
      status: 'INITIATED',
      metadata: {
        retailerMerchantId: 'pay_merchant_456',
      },
      paymentSnapshot: null,
      processedAt: null,
      amount: 10000,
      paymentPayload: {
        merchantId: 'pay_merchant_456',
        paymentMethod: {
          type: 'MPESA',
          provider: 'Safaricom',
          payerPhoneNumber: '+254700000000',
        },
        suppliers: [{ supplierMerchantId: 'pay_supplier_789', supplierTotalAmount: 10000 }],
      },
    }),
    findIntegrationByMerchantId: async (merchantId: string) => {
      if (merchantId === 'pay_merchant_456') {
        return {
          participant: {
            payment: {
              type: 'BANK',
              provider: 'Safaricom',
              shortcode: '600000',
              accountName: 'Retailer Account',
            },
          },
        };
      }
      if (merchantId === 'pay_supplier_789') {
        return {
          participant: {
            payment: {
              type: 'MPESA',
              provider: 'Safaricom',
              phoneNumber: '254712345678',
            },
          },
        };
      }
      return null;
    },
    updateSettlementStatus: async (_id: string, status: string, updates: any) => {
      updatedStatus = status;
      updatedPayload = updates;
      return { id: 'settlement-1', status, ...updates };
    },
  };

  const service = new SettlementService(repository as any);
  const response = await service.handlePaymentCallback({
    merchantTransactionReference: 'TXN-1001',
    status: 'SUCCESS',
    provider: 'M-PESA',
    providerReference: 'MPESA-123',
    amount: 16500,
    currency: 'KES',
  } as any);

  assert.equal(response.success, true);
  assert.equal(response.status, 'PENDING_PROCESSING');
  assert.equal(updatedStatus, 'PENDING_PROCESSING');
  assert.equal(updatedPayload.metadata.paymentCallback.merchantTransactionReference, 'TXN-1001');
  assert.equal(response.allocationPlan.allocations[0].party, 'Supplier');
  assert.equal(response.allocationPlan.paymentDetails.supplier.type, 'MPESA');
  assert.equal(response.allocationPlan.paymentDetails.supplier.phoneNumber, '254712345678');
  assert.equal(response.allocationPlan.paymentDetails.retailer.type, 'BANK');
  assert.equal(response.allocationPlan.paymentDetails.retailer.shortcode ?? response.allocationPlan.paymentDetails.retailer.phoneNumber, '600000');
});

test('confirmSettlementPayment records a customer payment confirmation and marks the settlement as pending processing', async () => {
  let updatedStatus: any = null;
  let updatedPayload: any = null;

  const repository = {
    findSettlementById: async () => ({
      id: 'settlement-4',
      status: 'INITIATED',
      amount: 2000,
      metadata: {},
      paymentSnapshot: null,
      processedAt: null,
      paymentPayload: {
        paymentMethod: {
          type: 'MPESA',
          provider: 'Safaricom',
          payerPhoneNumber: '+254700000001',
        },
      },
    }),
    updateSettlementStatus: async (_id: string, status: string, updates: any) => {
      updatedStatus = status;
      updatedPayload = updates;
      return { id: 'settlement-4', status, ...updates };
    },
  };

  const service = new SettlementService(repository as any);
  const response = await service.confirmSettlementPayment({
    settlementId: 'settlement-4',
    paymentId: 'pay-001',
    status: 'PAID',
    provider: 'MPESA',
    paidAmount: 2000,
    paidAt: '2026-07-24T10:00:00.000Z',
    providerReference: {
      checkoutRequestId: 'checkout-001',
      merchantRequestId: 'merchant-001',
      receiptNumber: 'RCPT-001',
    },
  } as any);

  assert.equal(response.success, true);
  assert.equal(response.status, 'PENDING_PROCESSING');
  assert.equal(updatedStatus, 'PENDING_PROCESSING');
  assert.equal(updatedPayload.metadata.paymentConfirmation.status, 'PAID');
  assert.equal(updatedPayload.metadata.paymentConfirmation.providerReference.receiptNumber, 'RCPT-001');
  assert.equal(response.allocationPlan.allocations[0].party, 'Supplier');
});

test('confirmSettlementPayment accepts a paid confirmation payload', async () => {
  const repository = {
    findSettlementById: async () => ({
      id: 'settlement-5',
      status: 'INITIATED',
      amount: 2000,
      metadata: {},
      paymentPayload: {
        paymentMethod: {
          type: 'MPESA',
          provider: 'Safaricom',
          payerPhoneNumber: '+254700000002',
        },
      },
    }),
    updateSettlementStatus: async () => ({ id: 'settlement-5' }),
  };

  const service = new SettlementService(repository as any);

  const response = await service.confirmSettlementPayment({
    settlementId: 'settlement-5',
    paymentId: 'pay-002',
    status: 'PAID',
    provider: 'MPESA',
    paidAmount: 2000,
    paidAt: '2026-07-24T10:10:00.000Z',
  } as any);

  assert.equal(response.success, true);
  assert.equal(response.status, 'PENDING_PROCESSING');
});

test('PaymentRecordService resolves the merchant reference from the saved callback lookup when the gateway payload is missing it', async () => {
  const originalFindFirst = prisma.mpesaTransaction.findFirst as any;
  const originalUpdate = prisma.mpesaTransaction.update as any;

  const callbackLookup = 'cb-lookup-123';
  let updatedRecord: any = null;

  (prisma.mpesaTransaction as any).findFirst = async () => ({
    id: 'txn-123',
    checkoutRequestId: 'ws_CO_123',
    merchantRequestId: 'merchant-123',
    callbackToken: callbackLookup,
    merchantTransactionReference: 'TXN-LOOKUP-REF',
    processingLogs: [],
  });

  (prisma.mpesaTransaction as any).update = async ({ where, data }: any) => {
    updatedRecord = { id: where.id, ...data };
    return updatedRecord;
  };

  try {
    const result = await paymentRecordService.upsertFromMpesaCallback({
      Body: {
        stkCallback: {
          MerchantRequestID: 'merchant-123',
          CheckoutRequestID: 'ws_CO_123',
          ResultCode: 0,
          ResultDesc: 'The service request is processed successfully.',
          CallbackMetadata: {
            Item: [
              { Name: 'Amount', Value: 200 },
              { Name: 'MpesaReceiptNumber', Value: 'RCPT-123' },
              { Name: 'TransactionDate', Value: 20260815154456 },
              { Name: 'PhoneNumber', Value: 254700000000 },
            ],
          },
        },
      },
    } as any, callbackLookup);

    assert.equal(result?.status, 'COMPLETED');
    assert.equal(updatedRecord.merchantTransactionReference, 'TXN-LOOKUP-REF');
    assert.equal(updatedRecord.processingLogs.at(-1), 'callback validated and transaction completed');
  } finally {
    (prisma.mpesaTransaction as any).findFirst = originalFindFirst;
    (prisma.mpesaTransaction as any).update = originalUpdate;
  }
});

test('sendB2bGatewayPayoutRequest treats Safaricom ResponseCode 1005 as a failed payout, not a dispatched payout', async () => {
  const originalInitiateB2B = b2bService.initiateB2B.bind(b2bService);
  b2bService.initiateB2B = async () => ({
    responseCode: '1005',
    responseDescription: 'The element SecurityCredential is invalid.',
    originatorConversationId: 'originator-1',
    conversationId: 'conversation-1',
    timestamp: '2026-08-16T21:08:10.320Z',
  });

  try {
    const service = new SettlementService({} as any);
    const result = await (service as any).sendB2bGatewayPayoutRequest({
      recipientShortCode: '600000',
      amount: 1,
      accountReference: 'John Doe',
      description: 'Settlement payout for SUPPLIER',
    });

    assert.equal(result.success, false);
    assert.equal(result.responseCode, '1005');
    assert.equal(result.responseDescription, 'The element SecurityCredential is invalid.');
  } finally {
    b2bService.initiateB2B = originalInitiateB2B;
  }
});

test('dispatchB2bPayouts accepts a settled processing-state settlement without a second callback record', async () => {
  let updatedStatus: any = null;
  let updatedPayload: any = null;

  const repository = {
    findSettlementByReference: async () => ({
      id: 'settlement-10',
      status: 'PROCESSING',
      merchantTransactionReference: 'TXN-DISPATCH-1',
      reference: 'REF-10',
      currency: 'KES',
      metadata: {
        paymentCallback: { status: 'SUCCESS', merchantTransactionReference: 'TXN-DISPATCH-1' },
        splitRecords: [{ totalAmount: 2000, merchantTransactionReference: 'TXN-DISPATCH-1', status: 'SUCCESS' }],
      },
      paymentSnapshot: { type: 'BANK', shortcode: '12345', accountName: 'ACCT NAME' },
      amount: 2000,
    }),
    updateSettlementStatus: async (_id: string, status: string, updates: any) => {
      updatedStatus = status;
      updatedPayload = updates;
      return { id: 'settlement-10', status, ...updates };
    },
  };

  const service = new SettlementService(repository as any);
  (service as any).sendB2bGatewayPayoutRequest = async () => ({ success: true, statusCode: 200, response: { gatewayId: 'gw-1' } });

  const response = await service.dispatchB2bPayouts({
    merchantTransactionReference: 'TXN-DISPATCH-1',
    party: 'SUPPLIER',
    supplierMerchantId: 'SUP-1001',
    amount: 1000,
  } as any);

  assert.equal(response.success, true);
  assert.equal(response.status, 'SUBMITTED');
  assert.equal(updatedStatus, 'PROCESSING');
  assert.equal(updatedPayload.metadata.payoutDispatches.length, 1);
});

test('dispatchB2bPayouts records a dispatch and updates settlement metadata', async () => {
  let updatedStatus: any = null;
  let updatedPayload: any = null;

  const repository = {
    findSettlementByReference: async () => ({
      id: 'settlement-10',
      merchantTransactionReference: 'TXN-DISPATCH-1',
      reference: 'REF-10',
      currency: 'KES',
      metadata: {
        paymentCallback: { status: 'SUCCESS', merchantTransactionReference: 'TXN-DISPATCH-1' },
      },
      paymentSnapshot: { type: 'BANK', shortcode: '12345', accountName: 'ACCT NAME' },
    }),
    updateSettlementStatus: async (_id: string, status: string, updates: any) => {
      updatedStatus = status;
      updatedPayload = updates;
      return { id: 'settlement-10', status, ...updates };
    },
  };

  const service = new SettlementService(repository as any);
  // stub external gateway call to avoid network in unit test
  (service as any).sendB2bGatewayPayoutRequest = async () => ({ success: true, statusCode: 200, response: { gatewayId: 'gw-1' } });

  const response = await service.dispatchB2bPayouts({
    merchantTransactionReference: 'TXN-DISPATCH-1',
    party: 'SUPPLIER',
    supplierMerchantId: 'SUP-1001',
    amount: 1000,
  } as any);

  assert.equal(response.success, true);
  assert.equal(response.status, 'SUBMITTED');
  assert.equal(updatedStatus, 'PROCESSING');
  assert.equal(updatedPayload.metadata.payoutDispatches.length, 1);
});

test('dispatchB2bPayouts validates payment confirmation against the parent settlement when the lookup resolves a child settlement', async () => {
  let updatedStatus: any = null;

  const repository = {
    findSettlementByReference: async () => ({
      id: 'child-settlement-1',
      status: 'INITIATED',
      merchantTransactionReference: 'MTXN-20260816220335-84A618453622-pay_d68f568ddc7d7b2a',
      reference: 'REF-CHILD-1',
      currency: 'KES',
      businessId: 'retailer-1',
      metadata: {
        parentSettlementId: 'parent-settlement-1',
        supplierMerchantId: 'pay_d68f568ddc7d7b2a',
      },
      paymentSnapshot: { type: 'BANK', shortcode: '12345', accountName: 'ACCT NAME' },
      paymentPayload: {
        merchants: [{ supplierMerchantId: 'pay_d68f568ddc7d7b2a' }],
      },
    }),
    findSettlementById: async (id: string) => {
      if (id !== 'parent-settlement-1') return null;
      return {
        id: 'parent-settlement-1',
        status: 'PENDING_PROCESSING',
        merchantTransactionReference: 'MTXN-20260816220335-84A618453622',
        reference: 'REF-PARENT-1',
        currency: 'KES',
        metadata: {
          paymentCallback: { status: 'SUCCESS', merchantTransactionReference: 'MTXN-20260816220335-84A618453622' },
          supplierMerchantId: 'pay_d68f568ddc7d7b2a',
        },
        paymentSnapshot: { type: 'BANK', shortcode: '12345', accountName: 'ACCT NAME' },
      };
    },
    updateSettlementStatus: async (_id: string, status: string, updates: any) => {
      updatedStatus = status;
      return { id: 'child-settlement-1', status, ...updates };
    },
  };

  const service = new SettlementService(repository as any);
  (service as any).sendB2bGatewayPayoutRequest = async () => ({ success: true, statusCode: 200, response: { gatewayId: 'gw-3' } });

  const response = await service.dispatchB2bPayouts({
    merchantTransactionReference: 'MTXN-20260816220335-84A618453622-pay_d68f568ddc7d7b2a',
    party: 'SUPPLIER',
    supplierMerchantId: 'pay_d68f568ddc7d7b2a',
    amount: 1000,
  } as any);

  assert.equal(response.success, true);
  assert.equal(response.status, 'SUBMITTED');
  assert.equal(updatedStatus, 'PROCESSING');
});

test('splitAndAllocateFunds returns failed status when both payout dispatches error', async () => {
  const repository = {
    findSettlementByReference: async () => ({
      id: 'settlement-fail-1',
      status: 'INITIATED',
      amount: 2000,
      currency: 'KES',
      businessId: 'retailer-1',
      reference: 'REF-FAIL-1',
      merchantTransactionReference: 'TXN-FAIL-1',
      metadata: {},
      paymentPayload: {
        merchantTransactionReference: 'TXN-FAIL-1',
        paymentMethod: { type: 'MPESA', provider: 'Safaricom', payerPhoneNumber: '+254700000099' },
        suppliers: [{ supplierMerchantId: 'SUP-9001', supplierTotalAmount: 1000, retailerTotalAmount: 1000, platformFee: 0 }],
      },
    }),
    updateSettlementStatus: async () => ({ id: 'settlement-fail-1' }),
  };

  const service = new SettlementService(repository as any);
  (service as any).dispatchB2bPayouts = async () => {
    throw new Error('B2B gateway unavailable');
  };

  const response = await service.splitAndAllocateFunds({
    merchantTransactionReference: 'TXN-FAIL-1',
    mpesaReceipt: 'RCP-FAIL-1',
    mpesaCheckoutRequestId: 'checkout-fail-1',
    mpesaMerchantRequestId: 'merchant-fail-1',
    resultCode: 0,
    resultDesc: 'The service request is processed successfully.',
  } as any);

  assert.equal(response.success, false);
  assert.equal(response.status, 'FAILED');
  assert.equal(response.errors.length, 2);
});

test('dispatchB2bPayouts falls back to supplier merchant ID from payment payload metadata', async () => {
  let updatedPayload: any = null;

  const repository = {
    findSettlementByReference: async () => ({
      id: 'settlement-12',
      merchantTransactionReference: 'TXN-DISPATCH-2',
      reference: 'REF-12',
      currency: 'KES',
      metadata: {
        paymentCallback: { status: 'SUCCESS', merchantTransactionReference: 'TXN-DISPATCH-2' },
      },
      paymentSnapshot: { type: 'BANK', shortcode: '12345', accountName: 'ACCT NAME' },
      paymentPayload: {
        suppliers: [{ supplierMerchantId: 'SUP-2001' }],
      },
    }),
    updateSettlementStatus: async (_id: string, status: string, updates: any) => {
      updatedPayload = updates;
      return { id: 'settlement-12', status, ...updates };
    },
  };

  const service = new SettlementService(repository as any);
  (service as any).sendB2bGatewayPayoutRequest = async () => ({ success: true, statusCode: 200, response: { gatewayId: 'gw-2' } });

  await service.dispatchB2bPayouts({
    merchantTransactionReference: 'TXN-DISPATCH-2',
    party: 'SUPPLIER',
    amount: 1000,
  } as any);

  assert.equal(updatedPayload.metadata.payoutDispatches[0].requestPayload.metadata.supplierMerchantId, 'SUP-2001');
});

test('handleB2bPayoutCallback updates allocation status and records callback', async () => {
  let updatedStatus: any = null;
  let updatedPayload: any = null;

  const repository = {
    findSettlementByReference: async () => ({
      id: 'settlement-11',
      merchantTransactionReference: 'TXN-CALLBACK-1',
      reference: 'REF-11',
      metadata: {
        allocationPlan: {
          allocations: [
            { party: 'SUPPLIER', amount: 18000, destination: 'B2B payout', status: 'PENDING' },
            { party: 'RETAILER', amount: 1600, destination: 'B2B payout', status: 'PENDING' },
          ],
        },
      },
    }),
    updateSettlementStatus: async (_id: string, status: string, updates: any) => {
      updatedStatus = status;
      updatedPayload = updates;
      return { id: 'settlement-11', status, ...updates };
    },
  };

  const service = new SettlementService(repository as any);
  const response = await service.handleB2bPayoutCallback({
    merchantTransactionReference: 'TXN-CALLBACK-1',
    reference: 'payout-abc',
    party: 'SUPPLIER',
    status: 'SUCCESS',
    providerReference: 'GW-123',
  } as any);

  assert.equal(response.success, true);
  assert.equal(updatedStatus, 'PROCESSING');
  assert.equal(updatedPayload.metadata.allocationPlan.allocations[0].status, 'PAID');
  assert.equal(updatedPayload.metadata.payoutCallbacks.length, 1);
});
