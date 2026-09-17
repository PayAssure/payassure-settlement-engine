import { Body, Controller, Post } from '@nestjs/common';
import { ApiBody, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { KcbFundsTransferDto } from './dto/kcb-funds-transfer.dto';
import { KcbService } from './kcb.service';

@ApiTags('KCB Funds Transfer')
@Controller('kcb')
export class KcbController {
  constructor(private readonly kcbService: KcbService) {}

  @Post('funds-transfer')
  @ApiOperation({
    summary: 'Initiate a standalone KCB funds transfer',
    description: 'Calls KCB OAuth and the KCB Funds Transfer API. This integration is standalone and is not invoked by settlement initiation, payment callbacks, or payout dispatch.',
  })
  @ApiBody({
    type: KcbFundsTransferDto,
    examples: {
      transfer: {
        summary: 'KCB UAT funds transfer',
        value: {
          beneficiaryDetails: 'JOHN DOE',
          companyCode: 'KE0010001',
          creditAccountNumber: '1279287799',
          currency: 'KES',
          debitAccountNumber: '1279258233',
          debitAmount: 26,
          paymentDetails: 'UT Fund withdrawal',
          transactionReference: 'FT1234567890',
          transactionType: 'IF',
          beneficiaryBankCode: '01',
        },
      },
    },
  })
  @ApiResponse({ status: 201, description: 'KCB transfer accepted for asynchronous processing.', schema: { example: { success: true, provider: 'KCB', transactionReference: 'FT1234567890', response: { statusCode: '0', statusMessage: 'Success', statusDescription: 'Request received for processing', merchantID: '263eb626-3fe7-4662-813e-f6f2962219e1', retrievalRefNumber: 'PCI663RSS' } } } })
  @ApiResponse({ status: 400, description: 'Invalid transfer request.' })
  @ApiResponse({ status: 503, description: 'KCB authentication or transfer request failed.' })
  async fundsTransfer(@Body() body: KcbFundsTransferDto) {
    return this.kcbService.initiateFundsTransfer(body);
  }
}