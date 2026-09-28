import { Body, Controller, ForbiddenException, Get, Post, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags, ApiResponse } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../auth/jwt-auth.guard';
import { mpesaService } from '../services/mpesa.service';
import { accountBalanceService } from '../services/account-balance.service';
import { b2pochiService } from '../services/b2pochi.service';
import { b2cService } from '../services/b2c.service';
import { InitiateStkPushDto, QueryStkStatusDto, DispatchB2bPayoutDto, DispatchB2PochiPayoutDto, DispatchB2CPayoutDto } from '../dto';

@ApiTags('Payments')
@Controller('payments')
export class MpesaController {
  @Get('health')
  @ApiOperation({ summary: 'Payment service health check' })
  @ApiResponse({ status: 200, description: 'Payment service is healthy' })
  health() {
    return { status: 'ok', service: 'payassure-settlement-engine' };
  }

  @Post('mpesa/stk')
  @ApiOperation({ summary: 'Initiate payment via M-Pesa STK push' })
  @ApiResponse({ status: 200, description: 'STK push initiated successfully' })
  @ApiResponse({ status: 400, description: 'Invalid request payload' })
  async initiateStk(@Body() body: InitiateStkPushDto) {
    return mpesaService.initiateStkPush(body);
  }

  @Post('mpesa/stk/query')
  @ApiOperation({ summary: 'Query M-Pesa STK transaction status' })
  @ApiResponse({ status: 200, description: 'STK status queried successfully' })
  @ApiResponse({ status: 400, description: 'Invalid checkout request ID' })
  async queryStk(@Body() body: QueryStkStatusDto) {
    return mpesaService.queryStkStatus(body.checkoutRequestId);
  }

  @Post('mpesa/account-balance')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth('access-token')
  @ApiOperation({
    summary: 'Request the M-Pesa account balance',
    description: 'Submits an asynchronous AccountBalance query using MPESA_RETAILER_* credentials, reserved for retailer escrow balance and B2B operations. Requires an ADMIN or SUPER_ADMIN token; Safaricom sends the result to the account-balance callback endpoint.',
  })
  @ApiResponse({ status: 200, description: 'Account balance query accepted; the balance is delivered asynchronously to the configured callback URL' })
  @ApiResponse({ status: 500, description: 'M-Pesa credentials are missing or Safaricom rejected the request' })
  async queryAccountBalance(@Req() request: any) {
    if (!['ADMIN', 'SUPER_ADMIN'].includes(request.user?.role)) {
      throw new ForbiddenException('Only administrators can query retailer escrow balances');
    }
    return accountBalanceService.queryAccountBalance();
  }

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
