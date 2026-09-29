import { Get, Param, Post } from '@nestjs/common';
import { ApiOperation, ApiResponse } from '@nestjs/swagger';
import { SettlementScenarioControllerBase } from './scenario.controller.base';

export abstract class SettlementRetryControllerBase extends SettlementScenarioControllerBase {
  @Get('payouts/retry-status/:settlementId')
  @ApiOperation({ summary: 'Get payout retry status for a settlement', description: 'View the status of payout attempts and retries for a specific settlement.' })
  @ApiResponse({ status: 200, description: 'Retry status retrieved successfully' })
  @ApiResponse({ status: 404, description: 'Settlement not found' })
  async getRetryStatus(@Param('settlementId') settlementId: string): Promise<any> {
    try {
      const retryStats = await this.settlementService.getPayoutRetryStatistics(settlementId);
      return { success: true, settlementId, retryStatistics: retryStats, timestamp: new Date().toISOString() };
    } catch (error) {
      this.logger.error('[RETRY] Failed to get retry status', { settlementId, error: error instanceof Error ? error.message : String(error) });
      throw error;
    }
  }

  @Get('payouts/pending-retries')
  @ApiOperation({ summary: 'Get all pending payout retries', description: 'Retrieve all payouts that are currently pending retry across all settlements.' })
  @ApiResponse({ status: 200, description: 'Pending retries retrieved successfully' })
  async getPendingRetries(): Promise<any> {
    try {
      const pendingRetries = await this.settlementService.getPendingPayoutRetries();
      return { success: true, count: pendingRetries.length, pendingRetries, timestamp: new Date().toISOString() };
    } catch (error) {
      this.logger.error('[RETRY] Failed to get pending retries', { error: error instanceof Error ? error.message : String(error) });
      throw error;
    }
  }

  @Post('payouts/manual-retry/:settlementId')
  @ApiOperation({ summary: 'Manually trigger retry for a settlement', description: 'Force immediate retry of failed payouts for a specific settlement.' })
  @ApiResponse({ status: 200, description: 'Retry triggered successfully' })
  @ApiResponse({ status: 404, description: 'Settlement not found' })
  async manualRetry(@Param('settlementId') settlementId: string): Promise<any> {
    try {
      const result = await this.settlementService.manualRetryPayouts(settlementId);
      return { success: true, settlementId, retryResult: result, timestamp: new Date().toISOString() };
    } catch (error) {
      this.logger.error('[RETRY] Manual retry failed', { settlementId, error: error instanceof Error ? error.message : String(error) });
      throw error;
    }
  }
}
