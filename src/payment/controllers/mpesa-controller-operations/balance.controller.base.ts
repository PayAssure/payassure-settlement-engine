import { Post, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../../auth/jwt-auth.guard';
import { accountBalanceService } from '../../services/account-balance.service';
import { retailerEscrowTransferService } from '../../../retailer';
import { MpesaHealthStkControllerBase } from './health-stk.controller.base';

export abstract class MpesaBalanceControllerBase extends MpesaHealthStkControllerBase {
  @Post('mpesa/account-balance')
  @ApiOperation({
    summary: 'Request the M-Pesa account balance',
    description: 'Submits an asynchronous AccountBalance query using the configured M-Pesa credentials. This endpoint is intentionally public and does not require JWT auth.',
  })
  @ApiResponse({ status: 200, description: 'Account balance query accepted; Safaricom returns the raw provider response asynchronously to the configured callback URL.' })
  @ApiResponse({ status: 500, description: 'M-Pesa credentials are missing or Safaricom rejected the request.' })
  async queryAccountBalance() {
    return accountBalanceService.queryAccountBalance();
  }

  @Post('mpesa/escrow-balance')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth('access-token')
  @ApiOperation({
    summary: 'Get the authenticated retailer virtual balance',
    description: 'Returns the authenticated retailer’s database-backed virtual balance. This endpoint does not query the shared physical M-Pesa account.',
  })
  @ApiResponse({
    status: 201,
    description: 'Database-derived retailer balance, including deposits, completed payouts, and active reservations.',
    schema: {
      example: {
        merchantId: 'pay_retailer_001',
        currency: 'KES',
        depositedBalance: 12500,
        paidOutBalance: 2000,
        reservedBalance: 1500,
        availableBalance: 9000,
        asOf: '2026-11-04T12:19:29.795Z',
      },
    },
  })
  @ApiResponse({ status: 401, description: 'Missing or invalid bearer token' })
  @ApiResponse({ status: 403, description: 'Authenticated user does not belong to an active retailer' })
  @ApiResponse({ status: 404, description: 'Retailer float configuration not found' })
  async getEscrowBalance(@Req() request: any) {
    const merchantId = await retailerEscrowTransferService.getAuthenticatedRetailerMerchantId(request.user);
    return retailerEscrowTransferService.getBalance(merchantId);
  }
}
