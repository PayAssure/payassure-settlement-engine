import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { EscrowIntelligenceController } from '../../escrow-intelligence/escrow-intelligence.controller';
import { retailerEscrowTransferService } from '../../retailer';
import { accountBalanceService } from '../services/account-balance.service';
import { MpesaController } from './mpesa.controller';

test('retailer escrow balance endpoints return the authenticated retailer ledger without querying Safaricom', async () => {
  const originalResolveMerchant = retailerEscrowTransferService.getAuthenticatedRetailerMerchantId;
  const originalGetBalance = retailerEscrowTransferService.getBalance;
  const originalQueryBalance = accountBalanceService.queryAccountBalance;
  const expectedBalance = {
    merchantId: 'pay_retailer_001',
    currency: 'KES',
    depositedBalance: 12500,
    paidOutBalance: 2000,
    reservedBalance: 1500,
    availableBalance: 9000,
  };
  const resolvedMerchants: string[] = [];

  try {
    retailerEscrowTransferService.getAuthenticatedRetailerMerchantId = async (user) => {
      assert.equal(user?.email, 'retailer@example.com');
      return 'pay_retailer_001';
    };
    retailerEscrowTransferService.getBalance = async (merchantId) => {
      resolvedMerchants.push(merchantId);
      return expectedBalance;
    };
    accountBalanceService.queryAccountBalance = async () => {
      throw new Error('Retailer balance endpoints must not query Safaricom');
    };

    const escrowController = Object.create(EscrowIntelligenceController.prototype) as EscrowIntelligenceController;
    const paymentController = new MpesaController();
    const request = { user: { email: 'retailer@example.com' } };

    assert.deepEqual(await escrowController.checkRetailerFloatBalance(request), expectedBalance);
    assert.deepEqual(await paymentController.getEscrowBalance(request), expectedBalance);
    assert.deepEqual(resolvedMerchants, ['pay_retailer_001', 'pay_retailer_001']);
  } finally {
    retailerEscrowTransferService.getAuthenticatedRetailerMerchantId = originalResolveMerchant;
    retailerEscrowTransferService.getBalance = originalGetBalance;
    accountBalanceService.queryAccountBalance = originalQueryBalance;
  }
});
