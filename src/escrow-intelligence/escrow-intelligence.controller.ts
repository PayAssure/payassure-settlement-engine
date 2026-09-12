import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { EscrowIntelligenceService } from './escrow-intelligence.service';
import { MockBankEscrowProvider } from './providers/mock-bank-escrow.provider';

@ApiTags('escrow')
@Controller('escrow')
export class EscrowIntelligenceController {
  constructor(
    private readonly escrowIntelligenceService: EscrowIntelligenceService,
    private readonly mockBankEscrowProvider: MockBankEscrowProvider,
  ) {}

  @Get('health')
  health() {
    return { ok: true, service: 'escrow-intelligence' };
  }

  @Post('reconcile')
  async reconcile(@Body() body: { customerId: string; date?: string }) {
    return this.escrowIntelligenceService.reconcileEscrow(body.customerId, body.date ? new Date(body.date) : new Date());
  }

  @Get('summary/:customerId')
  async summary(@Param('customerId') customerId: string, @Query('date') date?: string) {
    return this.escrowIntelligenceService.getDailyCustomerSummary(customerId, date ? new Date(date) : new Date());
  }

  @Get('history')
  history() {
    return this.escrowIntelligenceService.getReconciliationHistory();
  }

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

  @Post('mock/control-panel')
  setMockFailureMode(@Body() body: { mode?: 'none' | 'provider-down' | 'mismatch' | 'duplicate' | 'reversal' }) {
    if (process.env.NODE_ENV === 'production') {
      return { status: 'disabled', message: 'Mock control panel is disabled in production.' };
    }

    this.mockBankEscrowProvider.setFailureMode(body.mode ?? 'none');
    return {
      status: 'updated',
      mode: body.mode ?? 'none',
      provider: this.mockBankEscrowProvider.getProviderName(),
    };
  }

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

  @Get('mock/account/:customerId')
  getMockAccount(@Param('customerId') customerId: string) {
    if (process.env.NODE_ENV === 'production') {
      return { status: 'disabled', message: 'Mock escrow account lookup is disabled in production.' };
    }

    return this.mockBankEscrowProvider.getCustomerEscrowBalance(customerId);
  }

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

    return {
      ...result,
      provider,
      scenario,
      customerId,
    };
  }
}
