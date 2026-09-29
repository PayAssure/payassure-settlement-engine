import { Body, Post } from '@nestjs/common';
import { ApiBody, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { EquityBankPesalinkBankDto, EquityBankPesalinkMobileDto } from '../dto/equity-bank.dto';
import { EquityBankAccountControllerBase } from './equity-account.controller.base';

export abstract class EquityBankRemittanceControllerBase extends EquityBankAccountControllerBase {
  @Post('remittance/pesalink-account')
  @ApiOperation({ summary: 'Send money to a PesaLink bank account', description: 'Kenya-only PesaLink bank transfer. Signs transfer.amount+transfer.currencyCode+transfer.reference+destination.name+source.accountNumber.' })
  @ApiBody({ type: EquityBankPesalinkBankDto })
  @ApiResponse({ status: 201, description: 'PesaLink bank response from Finserve.', schema: { example: { status: true, code: 0, message: 'success', data: { transactionId: '112194688993', status: 'SUCCESS', description: 'Confirmed transfer' } } } })
  @ApiResponse({ status: 503, description: 'Finserve authentication or provider request failed.' })
  async pesalinkAccount(@Body() body: EquityBankPesalinkBankDto) {
    return this.equityBankService.pesalinkBankTransfer(body);
  }

  @Post('remittance/pesalink-mobile')
  @ApiOperation({ summary: 'Send money to a PesaLink mobile number', description: 'Signs transfer.amount+transfer.currencyCode+transfer.reference+destination.name+source.accountNumber.' })
  @ApiBody({ type: EquityBankPesalinkMobileDto })
  @ApiResponse({ status: 201, description: 'PesaLink mobile response from Finserve.', schema: { example: { status: true, code: 0, message: 'success', data: { transactionId: '041108128674', status: 'SUCCESS', description: 'Confirmed transfer' } } } })
  @ApiResponse({ status: 503, description: 'Finserve authentication or provider request failed.' })
  async pesalinkMobile(@Body() body: EquityBankPesalinkMobileDto) {
    return this.equityBankService.pesalinkMobileTransfer(body);
  }
}
