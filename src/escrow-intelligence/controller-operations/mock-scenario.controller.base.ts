import { Get, Param, Post, Body } from '@nestjs/common';
import { ApiExcludeEndpoint } from '@nestjs/swagger';
import { MockSetupControllerBase } from './mock-setup.controller.base';

export abstract class MockScenarioControllerBase extends MockSetupControllerBase {
  @ApiExcludeEndpoint()
  @Get('mock/account/:customerId')
  getMockAccount(@Param('customerId') customerId: string) {
    if (process.env.NODE_ENV === 'production') {
      return { status: 'disabled', message: 'Mock escrow account lookup is disabled in production.' };
    }
    return this.mockBankEscrowProvider.getCustomerEscrowBalance(customerId);
  }

  @ApiExcludeEndpoint()
  @Post('mock/scenario')
  async mockScenario(@Body() body: {
    customerId: string;
    amount?: number;
    provider?: 'MPESA' | 'CASH';
    scenario?: 'success' | 'provider-down' | 'mismatch' | 'duplicate' | 'reversal' | 'cash-collection';
    retailerEscrowBalance?: number;
    supplierAmount?: number;
    platformFee?: number;
    expectedTransactions?: Array<Record<string, any>>;
  }) {
    if (process.env.NODE_ENV === 'production') {
      return { status: 'disabled', message: 'Mock scenario endpoint is disabled in production.' };
    }
    const provider = body.provider ?? 'MPESA';
    const scenario = body.scenario ?? 'success';
    const customerId = body.customerId ?? 'CUST-MOCK';
    const result = await this.escrowIntelligenceService.simulateSettlementCollection({
      customerId,
      amount: Number(body.amount ?? 0),
      provider,
      scenario,
      supplierAmount: Number(body.supplierAmount ?? body.amount ?? 0),
      platformFee: Number(body.platformFee ?? 0),
      retailerEscrowBalance: Number(body.retailerEscrowBalance ?? 0),
      expectedTransactions: Array.isArray(body.expectedTransactions) ? body.expectedTransactions.map((txn) => ({
        id: String(txn.id ?? `${customerId}-txn-${Math.random().toString(36).slice(2, 8)}`),
        customerId: String(txn.customerId ?? customerId),
        date: String(txn.date ?? new Date().toISOString().slice(0, 10)),
        type: String(txn.type ?? 'CREDIT'),
        amount: Number(txn.amount ?? 0),
        description: String(txn.description ?? 'mock entry'),
      })) : [],
    });
    return { ...result, provider, scenario, customerId };
  }
}
