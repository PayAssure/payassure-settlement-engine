import { Body, Controller, Post } from '@nestjs/common';
import { ApiBody, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { CoopBankAccountEnquiryDto } from './dto/coop-bank-account-enquiry.dto';
import { CoopBankService } from './coop-bank.service';

@ApiTags('COOP Bank')
@Controller('coop-bank')
export class CoopBankController {
  constructor(private readonly coopBankService: CoopBankService) {}

  @Post('account-enquiry')
  @ApiOperation({
    summary: 'Query COOP Bank account transactions',
    description: 'Generates a COOP Bank OAuth token and calls the account transaction enquiry API using the current NestJS TypeScript service pattern.',
  })
  @ApiBody({
    type: CoopBankAccountEnquiryDto,
    examples: {
      accountEnquiry: {
        summary: 'COOP Bank account enquiry request',
        value: {
          messageReference: '40ca18c6765086089a1',
          accountNumber: '12345678912345',
          noOfTransactions: 1,
        },
      },
    },
  })
  @ApiResponse({
    status: 201,
    description: 'COOP Bank enquiry accepted.',
    schema: {
      example: {
        success: true,
        provider: 'COOP Bank',
        request: {
          MessageReference: '40ca18c6765086089a1',
          AccountNumber: '12345678912345',
          NoOfTransactions: '1',
        },
        response: {
          MessageReference: '40ca18c6765086089a1',
          MessageCode: '0',
          MessageDescription: 'Success',
          AccountNumber: '12345678912345',
          NoOfTransactions: '1',
          Transactions: [],
        },
      },
    },
  })
  @ApiResponse({ status: 400, description: 'Invalid COOP Bank request.' })
  @ApiResponse({ status: 503, description: 'COOP Bank authentication or enquiry request failed.' })
  async accountEnquiry(@Body() body: CoopBankAccountEnquiryDto) {
    return this.coopBankService.enquireAccountTransactions(body);
  }
}
