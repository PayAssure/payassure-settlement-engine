import { Post } from '@nestjs/common';
import { ApiOperation, ApiResponse } from '@nestjs/swagger';
import { accountBalanceService } from '../../services/account-balance.service';
import { retailerEscrowBalanceService } from '../../../retailer';
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
  @ApiOperation({
    summary: 'Get the retailer escrow account balance',
    description: 'Queries the retailer escrow balance using the dedicated MPESA_RETAILER_* sandbox credentials configured for escrow checks and B2B transfers.',
  })
  @ApiResponse({ status: 200, description: 'Escrow balance query accepted; the raw Safaricom account-balance response is returned.' })
  @ApiResponse({ status: 500, description: 'The retailer M-Pesa credentials are missing or Safaricom rejected the retailer escrow balance request.' })
  async getEscrowBalance() {
    return retailerEscrowBalanceService.queryBalance();
  }
}
