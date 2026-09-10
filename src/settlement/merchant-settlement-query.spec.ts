import assert = require('node:assert/strict');
import test = require('node:test');
import { SettlementService } from './settlement.service';

test('queries settlements by merchant integration and optional createdAt range', async () => {
  let receivedIntegrationId = '';
  let receivedFrom: Date | undefined;
  let receivedTo: Date | undefined;

  const service = new SettlementService(
    {
      findIntegrationByMerchantId: async (merchantId: string) => {
        assert.equal(merchantId, 'pay_retailer_001');
        return { id: 'integration-1' };
      },
      findSettlementsByIntegrationId: async (integrationId: string, from?: Date, to?: Date) => {
        receivedIntegrationId = integrationId;
        receivedFrom = from;
        receivedTo = to;
        return [{
          id: 'settlement-1',
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
  });

  assert.equal(receivedIntegrationId, 'integration-1');
  assert.equal(receivedFrom?.toISOString(), '2026-09-01T00:00:00.000Z');
  assert.equal(receivedTo?.toISOString(), '2026-10-01T00:00:00.000Z');
  assert.equal(response.count, 1);
  assert.equal(response.data[0].amount, 16500);
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
