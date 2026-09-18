import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsNumber, IsString, Min } from 'class-validator';

export class CoopBankAccountEnquiryDto {
  @ApiProperty({ example: '40ca18c6765086089a1', description: 'Unique request reference for the account enquiry.' })
  @IsString()
  @IsNotEmpty()
  messageReference = '';

  @ApiProperty({ example: '12345678912345', description: 'Account number to query.' })
  @IsString()
  @IsNotEmpty()
  accountNumber = '';

  @ApiProperty({ example: 1, description: 'Number of transactions to fetch.' })
  @IsNumber()
  @Min(1)
  noOfTransactions = 1;
}
