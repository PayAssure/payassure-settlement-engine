import { Body, Get, Post } from '@nestjs/common';
import { ApiExcludeEndpoint } from '@nestjs/swagger';
import { EscrowControllerContextBase } from './controller-context.base';

export abstract class MockSetupControllerBase extends EscrowControllerContextBase {
  @ApiExcludeEndpoint()
  @Get('mock/control-panel')
  mockControlPanel() {
    if (process.env.NODE_ENV === 'production') {
      return { status: 'disabled', message: 'Mock control panel is disabled in production.' };
    }
    return {
      status: 'enabled',
      provider: this.mockBankEscrowProvider.getProviderName(),
      supportedScenarios: ['success', 'provider-down', 'mismatch', 'duplicate', 'reversal', 'cash-collection'],
      notes: 'Use the POST /escrow/mock/scenario endpoint to simulate full payment and settlement flows.',
    };
  }

  @ApiExcludeEndpoint()
  @Post('mock/control-panel')
  setMockFailureMode(@Body() body: { mode?: 'none' | 'provider-down' | 'mismatch' | 'duplicate' | 'reversal' }) {
    if (process.env.NODE_ENV === 'production') {
      return { status: 'disabled', message: 'Mock control panel is disabled in production.' };
    }
    this.mockBankEscrowProvider.setFailureMode(body.mode ?? 'none');
    return { status: 'updated', mode: body.mode ?? 'none', provider: this.mockBankEscrowProvider.getProviderName() };
  }

  @ApiExcludeEndpoint()
  @Post('mock/account')
  async seedMockAccount(@Body() body: {
    customerId?: string;
    merchantId?: string;
    email?: string;
    businessName?: string;
    amount?: number;
    currency?: string;
    description?: string;
  }) {
    if (process.env.NODE_ENV === 'production') {
      return { status: 'disabled', message: 'Mock escrow account seeding is disabled in production.' };
    }
    const customerId = body.customerId ?? body.merchantId ?? body.email ?? 'CUST-MOCK';
    const seeded = await this.mockBankEscrowProvider.seedAccount(
      customerId,
      Number(body.amount ?? 0),
      body.currency ?? 'KES',
      {
        description: body.description ?? `Mock escrow seeded for ${body.businessName ?? customerId}`,
        email: body.email,
        merchantId: body.merchantId,
        businessName: body.businessName,
      },
    );
    return {
      status: 'seeded',
      customerId,
      balance: seeded.balance,
      currency: seeded.currency,
      transaction: seeded.transaction,
      note: 'Use this customerId/merchantId as the retailer escrow key when calling the cash settlement flow.',
    };
  }
}
