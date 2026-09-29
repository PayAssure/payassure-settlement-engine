import { Body, Get, Post } from '@nestjs/common';
import { ApiOperation, ApiResponse } from '@nestjs/swagger';
import { mpesaService } from '../../services/mpesa.service';
import { InitiateStkPushDto, QueryStkStatusDto } from '../../dto';

export abstract class MpesaHealthStkControllerBase {
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
}
