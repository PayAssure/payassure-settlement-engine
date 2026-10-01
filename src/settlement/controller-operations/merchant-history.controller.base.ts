import { Body, Param, Post, Get, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiParam, ApiQuery, ApiResponse } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../auth/jwt-auth.guard';
import { ReconcileSettlementDto } from '../dto/reconcile-settlement.dto';
import { SettlementHistoryQueryDto } from '../dto/settlement-history-query.dto';
import { ErrorResponseDto, ReconcileResponseDto } from '../dto/settlement-response.dto';
import { SettlementQueriesControllerBase } from './settlement-queries.controller.base';

export abstract class MerchantHistoryControllerBase extends SettlementQueriesControllerBase {
  @Get('merchant/:merchantId')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth('access-token')
  @ApiParam({ name: 'merchantId', example: 'pay_retailer_001', description: 'Merchant ID from the business integration credentials.' })
  @ApiQuery({ name: 'from', required: false, type: String, example: '2026-09-01T00:00:00.000Z', description: 'Inclusive createdAt lower bound in ISO 8601 format.' })
  @ApiQuery({ name: 'to', required: false, type: String, example: '2026-10-01T00:00:00.000Z', description: 'Exclusive createdAt upper bound in ISO 8601 format.' })
  @ApiQuery({ name: 'status', required: false, enum: ['INITIATED', 'PENDING_PROCESSING', 'PROCESSING', 'PROCESSING_COMPLETE', 'AWAITING_RECONCILIATION', 'COMPLETED', 'PROCESSING_FAILED', 'FAILED'], description: 'Filter by settlement status.' })
  @ApiOperation({ summary: 'Query settlement history by merchant ID', description: 'Returns settlements where merchantId is used as the retailer integration or as a supplier on a settlement transaction. Optional status, from, and to filters apply.' })
  @ApiResponse({ status: 200, description: 'Merchant settlements retrieved successfully.' })
  @ApiResponse({ status: 400, description: 'Invalid date filter or inverted date range.', type: ErrorResponseDto })
  @ApiResponse({ status: 401, description: 'Missing or invalid user access token.', type: ErrorResponseDto })
  @ApiResponse({ status: 404, description: 'Merchant integration not found and no supplier settlement matches the merchant ID.', type: ErrorResponseDto })
  async getSettlementsByMerchantId(@Param('merchantId') merchantId: string, @Query() filters: SettlementHistoryQueryDto) {
    return this.settlementService.getSettlementsByMerchantId(merchantId, filters);
  }

  @Post('reconcile')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth('access-token')
  @ApiOperation({ summary: 'Reconcile settlement', description: 'Submit bank reference and reconciliation data to confirm settlement completion' })
  @ApiResponse({ status: 200, description: 'Settlement reconciliation successful. Returns the updated reconciliation state.', type: ReconcileResponseDto })
  @ApiResponse({ status: 401, description: 'Unauthorized', type: ErrorResponseDto })
  @ApiResponse({ status: 404, description: 'Settlement not found', type: ErrorResponseDto })
  async reconcileSettlement(@Body() body: ReconcileSettlementDto): Promise<ReconcileResponseDto> {
    return this.settlementService.reconcileSettlement(body);
  }
}
