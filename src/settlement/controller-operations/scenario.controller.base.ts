import { Body, Get, Param, Post, UseGuards } from '@nestjs/common';
import { ApiExcludeEndpoint, ApiBearerAuth, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../auth/jwt-auth.guard';
import { AuthenticateDto } from '../dto/authenticate.dto';
import { InitiateSettlementDto } from '../dto/initiate-settlement.dto';
import { RunScenarioDto, RunScenarioResponseDto } from '../dto/run-scenario.dto';
import { ErrorResponseDto } from '../dto/settlement-response.dto';
import { MerchantHistoryControllerBase } from './merchant-history.controller.base';

export abstract class SettlementScenarioControllerBase extends MerchantHistoryControllerBase {
  @ApiExcludeEndpoint()
  @Post('scenarios/run')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth('access-token')
  @ApiOperation({
    summary: 'Run a documented settlement scenario from Swagger',
    description: 'Executes a predefined success or rejection scenario for settlement authentication and initiation. Useful for manual API testing and demonstrating how the platform behaves under fake or real credentials.',
  })
  @ApiResponse({ status: 200, description: 'Scenario executed successfully', type: RunScenarioResponseDto })
  @ApiResponse({ status: 400, description: 'Scenario request validation failed', type: ErrorResponseDto })
  async runScenario(@Body() body: RunScenarioDto): Promise<RunScenarioResponseDto> {
    const scenario = body.scenario;
    const credentialMode = body.credentialMode ?? 'fake';
    const apiKey = body.apiKey ?? 'pk_live_test123';
    const apiSecret = body.apiSecret ?? 'sk_live_test123';
    const merchantTransactionReference = body.merchantTransactionReference ?? `TXN-${scenario}`;
    const sessionToken = body.sessionToken ?? 'session-1';
    try {
      const authResult = await this.settlementService.authenticate(
        { apiKey, apiSecret } as AuthenticateDto,
        { email: body.userEmail ?? 'merchant@example.com' },
      );
      const token = authResult.token;
      if (scenario === 'happy-path') {
        const result = await this.settlementService.initiateSettlement(token, {
          merchantTransactionReference,
          totalAmount: body.totalAmount ?? 7200,
          currency: body.currency ?? 'KES',
          settlementMethod: body.settlementMethod ?? 'BANK_TRANSFER',
          paymentMethod: {
            type: body.paymentMethodType ?? 'MPESA',
            payerPhoneNumber: body.payerPhoneNumber ?? '254700000000',
            provider: (body.paymentMethodType ?? 'MPESA') === 'CASH' ? 'ESCROW' : 'MPESA',
          },
          transactionDate: '2026-07-03T17:30:15+03:00',
          suppliers: [{
            supplierMerchantId: body.supplierMerchantId ?? 'SUP-1001',
            items: [{ itemId: body.itemId ?? 'ITEM-001', supplierAmount: body.supplierAmount ?? 7200 }],
          }],
        } as InitiateSettlementDto);
        return {
          status: 'passed',
          scenario,
          message: 'Happy-path settlement scenario completed successfully.',
          details: { credentialMode, settlementId: result.settlement?.settlementId, merchantTransactionReference, token },
        };
      }
      if (scenario === 'expired-session') {
        try {
          await this.settlementService.initiateSettlement(sessionToken, {
            merchantTransactionReference,
            totalAmount: body.totalAmount ?? 7200,
            currency: body.currency ?? 'KES',
            settlementMethod: body.settlementMethod ?? 'BANK_TRANSFER',
            paymentMethod: {
              type: body.paymentMethodType ?? 'MPESA',
              payerPhoneNumber: body.payerPhoneNumber ?? '254700000000',
              provider: (body.paymentMethodType ?? 'MPESA') === 'CASH' ? 'ESCROW' : 'MPESA',
            },
            transactionDate: '2026-07-03T17:30:15+03:00',
            suppliers: [{ supplierMerchantId: body.supplierMerchantId ?? 'SUP-1001', items: [{ itemId: body.itemId ?? 'ITEM-001', supplierAmount: body.supplierAmount ?? 7200 }] }],
          } as InitiateSettlementDto);
          return { status: 'failed', scenario, message: 'Expired-session scenario unexpectedly succeeded.' };
        } catch (error: any) {
          return { status: 'passed', scenario, message: 'Expired-session scenario rejected as expected.', details: { credentialMode, error: error?.response?.message ?? error?.message } };
        }
      }
      if (scenario === 'invalid-payload') {
        try {
          await this.settlementService.initiateSettlement(token, {
            merchantTransactionReference,
            totalAmount: 0,
            currency: body.currency ?? 'KES',
            settlementMethod: body.settlementMethod ?? 'BANK_TRANSFER',
            paymentMethod: {
              type: body.paymentMethodType ?? 'MPESA',
              payerPhoneNumber: body.payerPhoneNumber ?? '254700000000',
              provider: (body.paymentMethodType ?? 'MPESA') === 'CASH' ? 'ESCROW' : 'MPESA',
            },
            transactionDate: '2026-07-03T17:30:15+03:00',
            suppliers: [{ supplierMerchantId: body.supplierMerchantId ?? 'SUP-1001', items: [{ itemId: body.itemId ?? 'ITEM-001', supplierAmount: body.supplierAmount ?? 7200 }] }],
          } as InitiateSettlementDto);
          return { status: 'failed', scenario, message: 'Invalid-payload scenario unexpectedly succeeded.' };
        } catch (error: any) {
          return { status: 'passed', scenario, message: 'Invalid-payload scenario rejected as expected.', details: { credentialMode, error: error?.response?.message ?? error?.message } };
        }
      }
    } catch (error: any) {
      if (scenario === 'invalid-credentials') {
        return { status: 'passed', scenario, message: 'Invalid credentials scenario rejected as expected.', details: { credentialMode, error: error?.response?.message ?? error?.message } };
      }
      return { status: 'failed', scenario, message: 'Scenario execution failed unexpectedly.', details: { credentialMode, error: error?.response?.message ?? error?.message } };
    }
    if (scenario === 'invalid-credentials') {
      return { status: 'failed', scenario, message: 'Invalid credentials scenario unexpectedly succeeded.' };
    }
    return { status: 'failed', scenario, message: 'Unsupported scenario requested.' };
  }

  @ApiExcludeEndpoint()
  @Get('health')
  @ApiOperation({ summary: 'Get settlement module health status' })
  @ApiResponse({ status: 200, schema: { example: { status: 'ok' } } })
  getHealth() {
    return { status: 'ok' };
  }

  @Post('split-and-payout/:merchantTransactionReference')
  @ApiOperation({ summary: 'Manually trigger split and payout dispatch (TEST/DEBUG)', description: 'Manually invoke the settlement split and payout dispatch process for a given settlement reference. Useful for testing scenarios.' })
  @ApiResponse({ status: 200, description: 'Split and payout dispatch completed' })
  @ApiResponse({ status: 404, description: 'Settlement not found' })
  async triggerSplitAndPayout(@Param('merchantTransactionReference') merchantTransactionReference: string, @Body() body: any): Promise<any> {
    try {
      const result = await this.settlementService.splitAndAllocateFunds({
        merchantTransactionReference,
        mpesaReceipt: body?.mpesaReceipt ?? undefined,
        mpesaCheckoutRequestId: body?.mpesaCheckoutRequestId ?? undefined,
        mpesaMerchantRequestId: body?.mpesaMerchantRequestId ?? undefined,
        resultCode: body?.resultCode ?? 0,
        resultDesc: body?.resultDesc ?? 'Manual trigger',
      });
      return { success: true, message: 'Split and payout dispatch initiated', data: result };
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      this.logger.error('[SETTLEMENT][TEST] Manual split and payout failed', {
        merchantTransactionReference,
        error: errorMsg,
        timestamp: new Date().toISOString(),
      });
      throw error;
    }
  }
}
