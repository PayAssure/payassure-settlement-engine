import { Body, Post } from '@nestjs/common';
import { ApiOperation, ApiResponse } from '@nestjs/swagger';
import { mpesaService } from '../../services/mpesa.service';
import { b2pochiService } from '../../services/b2pochi.service';
import { b2cService } from '../../services/b2c.service';
import { DispatchB2bPayoutDto, DispatchB2PochiPayoutDto, DispatchB2CPayoutDto } from '../../dto';
import { MpesaBalanceControllerBase } from './balance.controller.base';

export abstract class MpesaPayoutControllerBase extends MpesaBalanceControllerBase {
  @Post('mpesa/b2b')
  @ApiOperation({ summary: 'Dispatch a B2B payout request through M-Pesa' })
  @ApiResponse({ status: 200, description: 'B2B payout dispatched successfully' })
  @ApiResponse({ status: 400, description: 'Invalid payout request payload' })
  async b2b(@Body() body: DispatchB2bPayoutDto) {
    return mpesaService.dispatchB2bPayout(body);
  }

  @Post('mpesa/b2pochi')
  @ApiOperation({ summary: 'Dispatch a B2Pochi payment to a customer business wallet (pochi la biashara)' })
  @ApiResponse({ status: 200, description: 'B2Pochi payout request accepted by M-Pesa' })
  @ApiResponse({ status: 400, description: 'Invalid B2Pochi payout request payload' })
  async b2pochi(@Body() body: DispatchB2PochiPayoutDto) {
    return b2pochiService.initiateB2Pochi(body as Record<string, any>);
  }

  @Post('mpesa/b2c')
  @ApiOperation({ summary: 'Dispatch a B2C payment to an M-Pesa customer' })
  @ApiResponse({ status: 200, description: 'B2C payment request accepted by M-Pesa' })
  @ApiResponse({ status: 400, description: 'Invalid B2C payment request payload' })
  async b2c(@Body() body: DispatchB2CPayoutDto) {
    return b2cService.initiateB2C(body as Record<string, any>);
  }
}
