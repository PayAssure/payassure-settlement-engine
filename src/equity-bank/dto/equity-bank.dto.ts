import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsOptional, IsString, Matches, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';

export class EquityBankAccountBalanceDto {
  @ApiProperty({ example: 'KE', description: 'Supported Equity Bank country code.' })
  @IsString()
  @IsNotEmpty()
  @Matches(/^[A-Za-z]{2,3}$/)
  countryCode = 'KE';

  @ApiProperty({ example: '00201XXXX14605', description: 'Equity Bank account number.' })
  @IsString()
  @IsNotEmpty()
  accountId = '';

  @ApiProperty({ example: '2023-10-13', required: false, description: 'Optional signing date in YYYY-MM-DD format; when absent the current date is used.' })
  @IsString()
  @IsOptional()
  date?: string;
}

export class EquityBankSourceDto {
  @ApiProperty({ example: 'KE' })
  @IsString()
  @IsNotEmpty()
  countryCode = 'KE';

  @ApiProperty({ example: 'John Doe' })
  @IsString()
  @IsNotEmpty()
  name = '';

  @ApiProperty({ example: '00013XXXX6836' })
  @IsString()
  @IsNotEmpty()
  accountNumber = '';
}

export class EquityBankDestinationDto {
  @ApiProperty({ example: 'bank', enum: ['bank', 'mobile'] })
  @IsString()
  @IsNotEmpty()
  type = 'bank';

  @ApiProperty({ example: 'KE' })
  @IsString()
  @IsNotEmpty()
  countryCode = 'KE';

  @ApiProperty({ example: 'Tom Doe' })
  @IsString()
  @IsNotEmpty()
  name = '';

  @ApiProperty({ example: '00201XXXX4605', required: false })
  @IsString()
  @IsOptional()
  accountNumber?: string;

  @ApiProperty({ example: '57', required: false })
  @IsString()
  @IsOptional()
  bankCode?: string;

  @ApiProperty({ example: '0722000000', required: false })
  @IsString()
  @IsOptional()
  mobileNumber?: string;
}

export class EquityBankTransferDto {
  @ApiProperty({ example: 'EFT' })
  @IsString()
  @IsNotEmpty()
  type = 'EFT';

  @ApiProperty({ example: '500.00', description: 'Positive amount formatted with two decimal places.' })
  @IsString()
  @IsNotEmpty()
  amount = '0.00';

  @ApiProperty({ example: 'KES' })
  @IsString()
  @IsNotEmpty()
  currencyCode = 'KES';

  @ApiProperty({ example: '192112602006', description: 'Unique transaction reference.' })
  @IsString()
  @IsNotEmpty()
  reference = '';

  @ApiProperty({ example: '2023-10-13' })
  @IsString()
  @IsNotEmpty()
  date = '';

  @ApiProperty({ example: 'Some remarks here' })
  @IsString()
  @IsNotEmpty()
  description = '';
}

export class EquityBankInternalTransferDto {
  @ApiProperty({ type: EquityBankSourceDto })
  @ValidateNested()
  @Type(() => EquityBankSourceDto)
  source = new EquityBankSourceDto();

  @ApiProperty({ type: EquityBankDestinationDto })
  @ValidateNested()
  @Type(() => EquityBankDestinationDto)
  destination = new EquityBankDestinationDto();

  @ApiProperty({ type: EquityBankTransferDto })
  @ValidateNested()
  @Type(() => EquityBankTransferDto)
  transfer = new EquityBankTransferDto();
}

export class EquityBankPesalinkBankDto extends EquityBankInternalTransferDto {
  @ApiProperty({ type: EquityBankDestinationDto, example: { type: 'bank', countryCode: 'KE', name: 'Tom Doe', bankCode: '57', accountNumber: '99901288715910' } })
  @ValidateNested()
  @Type(() => EquityBankDestinationDto)
  destination = new EquityBankDestinationDto();

  @ApiProperty({ type: EquityBankTransferDto, example: { type: 'PesaLink', amount: '500.00', currencyCode: 'KES', reference: '112194688993', date: '2023-10-11', description: 'Some remarks here' } })
  @ValidateNested()
  @Type(() => EquityBankTransferDto)
  transfer = new EquityBankTransferDto();
}

export class EquityBankPesalinkMobileDto extends EquityBankInternalTransferDto {
  @ApiProperty({ type: EquityBankDestinationDto, example: { type: 'mobile', countryCode: 'KE', name: 'Tom Doe', bankCode: '01', mobileNumber: '0722000000' } })
  @ValidateNested()
  @Type(() => EquityBankDestinationDto)
  destination = new EquityBankDestinationDto();

  @ApiProperty({ type: EquityBankTransferDto, example: { type: 'PesaLink', amount: '40.00', currencyCode: 'KES', reference: '692194625798', date: '2019-05-01', description: 'Some remarks here' } })
  @ValidateNested()
  @Type(() => EquityBankTransferDto)
  transfer = new EquityBankTransferDto();
}