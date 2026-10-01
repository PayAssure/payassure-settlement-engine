import assert = require('node:assert/strict');
import test = require('node:test');
import { SettlementService } from './settlement.service';

test('queries settlements by merchant integration and optional createdAt range', async () => {
  let receivedIntegrationId = '';
  let receivedFrom: Date | undefined;
  let receivedTo: Date | undefined;
  let receivedStatus: string | undefined;

  const service = new SettlementService(
    {
      findIntegrationByMerchantId: async (merchantId: string) => {
        assert.equal(merchantId, 'pay_retailer_001');
        return { id: 'integration-1' };
      },
      findSettlementsByMerchantId: async (_merchantId: string, integrationId: string, from?: Date, to?: Date, status?: string) => {
        receivedIntegrationId = integrationId;
        receivedFrom = from;
        receivedTo = to;
        receivedStatus = status;
        return [{
          id: 'settlement-1',
          integrationId: 'integration-1',
          reference: 'PASTL-1',
          merchantTransactionReference: 'MTXN-1',
          status: 'COMPLETED',
          amount: 16500,
          currency: 'KES',
          settlementMethod: 'BANK_TRANSFER',
          description: 'Daily batch',
          createdAt: new Date('2026-09-10T08:30:00.000Z'),
          transactions: [],
        }];
      },
    } as any,
    {} as any,
    {} as any,
  );

  const response = await service.getSettlementsByMerchantId('pay_retailer_001', {
    from: '2026-09-01T00:00:00.000Z',
    to: '2026-10-01T00:00:00.000Z',
    status: 'COMPLETED' as any,
  });

  assert.equal(receivedIntegrationId, 'integration-1');
  assert.equal(receivedFrom?.toISOString(), '2026-09-01T00:00:00.000Z');
  assert.equal(receivedTo?.toISOString(), '2026-10-01T00:00:00.000Z');
  assert.equal(receivedStatus, 'COMPLETED');
  assert.equal(response.count, 1);
  assert.equal(response.data[0].amount, 16500);
  assert.deepEqual(response.data[0].matchedPositions, ['RETAILER']);
});

test('returns settlements where the merchant is used as a supplier', async () => {
  let integrationLookupCount = 0;
  const service = new SettlementService(
    {
      findIntegrationByMerchantId: async () => {
        integrationLookupCount += 1;
        return integrationLookupCount === 1 ? null : { participant: { businessName: 'Acme Supplies Ltd' } };
      },
      findSettlementsByMerchantId: async (_merchantId: string, integrationId: string | undefined, _from: Date | undefined, _to: Date | undefined, status: string) => {
        assert.equal(integrationId, undefined);
        assert.equal(status, 'PROCESSING');
        return [{
          id: 'settlement-2',
          integrationId: 'retailer-integration',
          reference: 'PASTL-2',
          merchantTransactionReference: 'MTXN-2',
          status: 'PROCESSING',
          amount: 5000,
          currency: 'KES',
          settlementMethod: 'BANK_TRANSFER',
          description: 'Supplier settlement',
          createdAt: new Date('2026-09-12T08:30:00.000Z'),
          transactions: [{ supplierMerchantId: 'pay_supplier_001' }],
        }];
      },
    } as any,
    {} as any,
    {} as any,
  );

  const response = await service.getSettlementsByMerchantId('pay_supplier_001', { status: 'PROCESSING' as any });

  assert.equal(response.count, 1);
  assert.deepEqual(response.data[0].matchedPositions, ['SUPPLIER']);
  assert.equal(response.data[0].transactions[0].supplierName, 'Acme Supplies Ltd');
  assert.equal(response.data[0].transactions[0].supplierMerchantId, undefined);
});

test('rejects an inverted settlement history date range', async () => {
  const service = new SettlementService({} as any, {} as any, {} as any);

  await assert.rejects(
    () => service.getSettlementsByMerchantId('pay_retailer_001', {
      from: '2026-10-01T00:00:00.000Z',
      to: '2026-09-01T00:00:00.000Z',
    }),
    (error: any) => error.response?.error === 'INVALID_DATE_RANGE',
  );
});
