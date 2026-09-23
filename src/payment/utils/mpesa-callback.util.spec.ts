import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { parseStkCallback } from './mpesa-callback.util';

test('parseStkCallback supports a single ResultParameter object', () => {
  const parsed = parseStkCallback({
    Result: {
      ConversationID: 'conversation-1',
      ResultCode: 0,
      ResultDesc: 'The service request is processed successfully.',
      ResultParameters: {
        ResultParameter: {
          Key: 'TransactionReceipt',
          Value: 'ABC123XYZ',
        },
      },
    },
  });

  assert.equal(parsed.status, 'completed');
  assert.equal(parsed.receipt, 'ABC123XYZ');
  assert.equal(parsed.checkoutRequestId, 'conversation-1');
});

test('parseStkCallback supports the standard ResultParameter array', () => {
  const parsed = parseStkCallback({
    Result: {
      ConversationID: 'conversation-2',
      ResultCode: 0,
      ResultParameters: {
        ResultParameter: [
          { Key: 'TransactionAmount', Value: 5 },
          { Key: 'TransactionReceipt', Value: 'XYZ789' },
        ],
      },
    },
  });

  assert.equal(parsed.amount, '5');
  assert.equal(parsed.receipt, 'XYZ789');
});