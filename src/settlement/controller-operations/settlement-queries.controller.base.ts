import { Get, Param, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../auth/jwt-auth.guard';
import { ErrorResponseDto, TrackSettlementResponseDto } from '../dto/settlement-response.dto';
import { PayoutCallbacksControllerBase } from './payout-callbacks.controller.base';

export abstract class SettlementQueriesControllerBase extends PayoutCallbacksControllerBase {
  @Get('track/:settlementId')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth('access-token')
  @ApiOperation({ summary: 'Track settlement status', description: 'Retrieve current status and transaction details for a settlement' })
  @ApiResponse({ status: 200, description: 'Settlement status retrieved successfully. Returns current status and transaction summary.', type: TrackSettlementResponseDto })
  @ApiResponse({ status: 401, description: 'Unauthorized - invalid or missing authentication token', type: ErrorResponseDto })
  @ApiResponse({ status: 404, description: 'Settlement not found', type: ErrorResponseDto })
  async trackSettlement(@Param('settlementId') settlementId: string, view: 'retailer' | 'supplier' | 'payassure' = 'retailer'): Promise<any> {
    return this.settlementService.trackSettlement(settlementId, view);
  }

  @Get('transactions/:transactionId')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth('access-token')
  @ApiOperation({ summary: 'Get transaction details', description: 'Retrieve detailed information about a specific transaction' })
  @ApiResponse({ status: 200, description: 'Transaction details retrieved successfully.', type: Object })
  @ApiResponse({ status: 401, description: 'Unauthorized', type: ErrorResponseDto })
  @ApiResponse({ status: 404, description: 'Transaction not found', type: ErrorResponseDto })
  async getTransaction(@Param('transactionId') transactionId: string) {
    return this.settlementService.getTransaction(transactionId);
  }
}
