import { Body, Post } from '@nestjs/common';
import { ApiOperation, ApiResponse } from '@nestjs/swagger';
import B2bPayoutDispatchDto from '../dto/b2b-payout.dto';
import { PaymentConfirmationControllerBase } from './payment-confirmation.controller.base';

export abstract class PayoutDispatchControllerBase extends PaymentConfirmationControllerBase {
  @Post('payouts/dispatch')
  @ApiOperation({ summary: 'Dispatch B2B payouts for a settlement', description: 'Sends payout instructions to the configured B2B gateway using the amounts owed to each party and their saved payout details.' })
  @ApiResponse({ status: 200, description: 'B2B payouts dispatched successfully.' })
  @ApiResponse({ status: 404, description: 'Settlement not found or payment callback has not completed successfully.' })
  async dispatchB2bPayouts(@Body() body: B2bPayoutDispatchDto): Promise<any> {
    return this.settlementService.dispatchB2bPayouts(body);
  }
}
