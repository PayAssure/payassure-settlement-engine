import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { ApiBody, ApiOperation, ApiParam, ApiQuery, ApiResponse, ApiTags } from '@nestjs/swagger';
import {
  EquityBankAccountBalanceDto,
  EquityBankInternalTransferDto,
  EquityBankPesalinkBankDto,
  EquityBankPesalinkMobileDto,
} from './dto/equity-bank.dto';
import { EquityBankService } from './equity-bank.service';

@ApiTags('Equity Bank / Finserve')
@Controller('equity-bank')
export class EquityBankController {
  constructor(private readonly equityBankService: EquityBankService) {}

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
  @ApiOperation({ summary: 'Transfer funds between Equity Bank accounts', description: 'Signs source.accountNumber+transfer.amount+transfer.currencyCode+transfer.reference.' })
  @ApiBody({ type: EquityBankInternalTransferDto })
  @ApiResponse({ status: 201, description: 'Internal transfer response from Finserve.', schema: { example: { status: true, code: 0, message: 'success', reference: '192112602006', data: { transactionId: '5414', status: 'SUCCESS' } } } })
  @ApiResponse({ status: 503, description: 'Finserve authentication or provider request failed.' })
  async internalTransfer(@Body() body: EquityBankInternalTransferDto) { return this.equityBankService.internalBankTransfer(body); }

  @Post('remittance/pesalink-account')
  @ApiOperation({ summary: 'Send money to a PesaLink bank account', description: 'Kenya-only PesaLink bank transfer. Signs transfer.amount+transfer.currencyCode+transfer.reference+destination.name+source.accountNumber.' })
  @ApiBody({ type: EquityBankPesalinkBankDto })
  @ApiResponse({ status: 201, description: 'PesaLink bank response from Finserve.', schema: { example: { status: true, code: 0, message: 'success', data: { transactionId: '112194688993', status: 'SUCCESS', description: 'Confirmed transfer' } } } })
  @ApiResponse({ status: 503, description: 'Finserve authentication or provider request failed.' })
  async pesalinkAccount(@Body() body: EquityBankPesalinkBankDto) { return this.equityBankService.pesalinkBankTransfer(body); }

  @Post('remittance/pesalink-mobile')
  @ApiOperation({ summary: 'Send money to a PesaLink mobile number', description: 'Signs transfer.amount+transfer.currencyCode+transfer.reference+destination.name+source.accountNumber.' })
  @ApiBody({ type: EquityBankPesalinkMobileDto })
  @ApiResponse({ status: 201, description: 'PesaLink mobile response from Finserve.', schema: { example: { status: true, code: 0, message: 'success', data: { transactionId: '041108128674', status: 'SUCCESS', description: 'Confirmed transfer' } } } })
  @ApiResponse({ status: 503, description: 'Finserve authentication or provider request failed.' })
  async pesalinkMobile(@Body() body: EquityBankPesalinkMobileDto) { return this.equityBankService.pesalinkMobileTransfer(body); }
}