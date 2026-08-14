import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsNotEmpty, IsOptional, IsString, IsNumber } from 'class-validator';

export default class DispatchB2bPayoutDto {
  @ApiProperty({
    example: 'TXN-DISPATCH-1',
    description: 'Merchant transaction reference for the payout',
  })
  @IsString()
  @IsNotEmpty()
  merchantTransactionReference: string = '';

  @ApiProperty({
    example: 'SUPPLIER',
    description: 'Party type: SUPPLIER or RETAILER',
  })
  @IsString()
  @IsNotEmpty()
  party: string = '';

  @ApiProperty({
    example: 1000,
    description: 'Payout amount in KES',
  })
  @IsNumber()
  @IsNotEmpty()
  amount: number = 0;

  @ApiPropertyOptional({
    example: 'SUP-1001',
    description: 'Supplier merchant ID for payout tracking',
  })
  @IsString()
  @IsOptional()
  supplierMerchantId?: string;

  @ApiPropertyOptional({
    example: '12345',
    description: 'Recipient account short code (bank account)',
  })
  @IsString()
  @IsOptional()
  recipientShortCode?: string;

  @ApiPropertyOptional({
    example: 'ACCOUNT NAME',
    description: 'Recipient account name',
  })
  @IsString()
  @IsOptional()
  accountReference?: string;

  @ApiPropertyOptional({
    example: 'KES',
    description: 'Currency code for the payout',
  })
  @IsString()
  @IsOptional()
  currency?: string;

  @ApiPropertyOptional({
    example: 'http://localhost:3000/callbacks/mpesa/b2b/payout',
    description: 'Callback URL for payout result',
  })
  @IsString()
  @IsOptional()
  callbackUrl?: string;

  @ApiPropertyOptional({
    example: 'B2B payout to SUPPLIER',
    description: 'Remarks for the transaction',
  })
  @IsString()
  @IsOptional()
  remarks?: string;

  @ApiPropertyOptional({
    example: 'Settlement payout for SUPPLIER',
    description: 'Transaction description',
  })
  @IsString()
  @IsOptional()
  description?: string;

  @ApiPropertyOptional({
    example: 'settlement-10',
    description: 'Settlement ID for payout tracking',
  })
  @IsString()
  @IsOptional()
  settlementId?: string;

  @ApiPropertyOptional({
    description: 'Additional metadata for the payout',
  })
  @IsOptional()
  metadata?: Record<string, any>;
}
