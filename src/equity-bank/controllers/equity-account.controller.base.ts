import { Body, Get, HttpCode, HttpStatus, Param, Post, Query } from '@nestjs/common';
import { ApiBody, ApiOperation, ApiParam, ApiQuery, ApiResponse } from '@nestjs/swagger';
import {
  EquityBankAccountBalanceDto,
  EquityBankInternalTransferDto,
} from '../dto/equity-bank.dto';
import { EquityBankControllerContextBase } from './equity-controller-context.base';

export abstract class EquityBankAccountControllerBase extends EquityBankControllerContextBase {
  @Get('accounts/balances/:countryCode/:accountId')
  @ApiOperation({ summary: 'Retrieve an Equity Bank account balance', description: 'Authenticates with Finserve, signs accountId + countryCode + date, and calls the UAT or live account balance API.' })
  @ApiParam({ name: 'countryCode', example: 'KE', required: true, description: 'Two-letter Equity Bank country code.' })
  @ApiParam({ name: 'accountId', example: '00201XXXX14605', required: true, description: 'Equity Bank account number.' })
  @ApiQuery({ name: 'date', required: false, example: '2023-10-13', description: 'Signing date in YYYY-MM-DD format. If omitted, today is used.' })
  @ApiResponse({ status: 200, description: 'Account balance response from Finserve.', schema: { example: { status: true, code: 0, message: 'success', data: { balances: [{ amount: '5655.58', type: 'Available' }, { amount: '5655.58', type: 'Current' }], currency: 'KES' } } } })
  @ApiResponse({ status: 503, description: 'Finserve authentication or provider request failed.' })
  async accountBalance(
    @Param('countryCode') countryCode: string,
    @Param('accountId') accountId: string,
    @Query('date') date?: string,
  ) {
    return this.equityBankService.getAccountBalance({ countryCode, accountId, date } as EquityBankAccountBalanceDto);
  }

  @Post('remittance/internal-bank-transfer')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Transfer funds between Equity Bank accounts', description: 'Signs source.accountNumber+transfer.amount+transfer.currencyCode+transfer.reference.' })
  @ApiBody({ type: EquityBankInternalTransferDto })
  @ApiResponse({ status: 200, description: 'Internal transfer response from Finserve.', schema: { example: { status: true, code: 0, message: 'success', reference: '192112602006', data: { transactionId: '5414', status: 'SUCCESS' } } } })
  @ApiResponse({ status: 503, description: 'Finserve authentication or provider request failed.' })
  async internalTransfer(@Body() body: EquityBankInternalTransferDto) {
    return this.equityBankService.internalBankTransfer(body);
  }
}
