import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import { PATH_METADATA } from '@nestjs/common/constants';
import { SettlementController } from './settlement.controller';

test('payment confirmation endpoint is exposed at settlements/payment-confirmation', () => {
  const path = Reflect.getMetadata(PATH_METADATA, SettlementController.prototype.confirmSettlementPayment);
  const normalizedPath = Array.isArray(path) ? path[0] : path;

  assert.equal(normalizedPath, 'payment-confirmation');
});
