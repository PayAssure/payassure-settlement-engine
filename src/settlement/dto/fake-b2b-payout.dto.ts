import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsNotEmpty, IsOptional, IsString } from 'class-validator';

export default class FakeB2bPayoutDto {
  @ApiProperty({ example: 'PAY-001', description: 'Ledger payout reference for the payout instruction.' })
  @IsString()
  @IsNotEmpty()
  reference: string = '';

  @ApiProperty({ example: 'PAYASSURE', description: 'Merchant identifier of the originator.' })
  @IsString()
  @IsNotEmpty()
  fromMerchantId: string = '';

  @ApiProperty({ example: 'SUPPLIER-001', description: 'Merchant identifier of the beneficiary.' })
  @IsString()
  @IsNotEmpty()
  toMerchantId: string = '';

  @ApiProperty({ example: 14850, description: 'Amount to send through the fake B2B gateway.' })
  @IsNotEmpty()
  amount: number = 0;

  @ApiProperty({ example: 'KES', description: 'Currency of the payout request.' })
  @IsString()
  @IsNotEmpty()
  currency: string = 'KES';

  @ApiPropertyOptional({ description: 'Settlement context for the payout request.' })
  @IsOptional()
  settlementReference?: string;

  @ApiPropertyOptional({ description: 'Merchant transaction reference associated with the settlement.' })
  @IsOptional()
  merchantTransactionReference?: string;

  @ApiPropertyOptional({ description: 'Payment method details for the payout.' })
  @IsOptional()
  paymentMethod?: Record<string, any>;
}
