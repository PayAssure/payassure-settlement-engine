import { Body, Controller, Get, Post, Query, Req, Res } from '@nestjs/common';
import { ApiOperation, ApiTags, ApiResponse } from '@nestjs/swagger';
import { Request, Response } from 'express';
import { mpesaService } from '../services/mpesa.service';
import { InitiateStkPushDto, QueryStkStatusDto, DispatchB2bPayoutDto, MpesaCallbackDto } from '../dto';

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

  @Post('mpesa/b2b')
  @ApiOperation({ summary: 'Dispatch a B2B payout request through M-Pesa' })
  @ApiResponse({ status: 200, description: 'B2B payout dispatched successfully' })
  @ApiResponse({ status: 400, description: 'Invalid payout request payload' })
  async b2b(@Body() body: DispatchB2bPayoutDto) {
    return mpesaService.dispatchB2bPayout(body);
  }

  @Post('callbacks/mpesa')
  @ApiOperation({ summary: 'Receive an M-Pesa callback notification' })
  async callback(@Req() req: Request, @Res() res: Response) {
    res.json({ ok: true, received: req.body, source: 'internal-payment-module' });
  }

  @Get('callbacks/mpesa')
  async callbackGet(@Query() query: any, @Res() res: Response) {
    res.json({ ok: true, query, source: 'internal-payment-module' });
  }
}
