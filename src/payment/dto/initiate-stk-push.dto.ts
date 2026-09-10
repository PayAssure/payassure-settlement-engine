import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsNotEmpty, IsOptional, IsString, IsNumber, IsPhoneNumber } from 'class-validator';

export default class InitiateStkPushDto {
  @ApiProperty({
    example: '254700000000',
    description: 'Mobile number to receive the STK push prompt (accepts formats: 254700000000, 0700000000, +254700000000)',
  })
  @IsNotEmpty()
  mobileNumber: string = '';

  @ApiProperty({
    example: 1000,
    description: 'Amount to be paid in KES',
  })
  @IsNumber()
  @IsNotEmpty()
  amount: number = 0;

  @ApiPropertyOptional({
    example: 'payassure',
    description: 'Account reference displayed to the customer during STK prompt',
  })
  @IsString()
  @IsOptional()
  accountReference?: string;

  @ApiPropertyOptional({
    example: 'Payment for goods and services',
    description: 'Transaction description displayed to the customer',
  })
  @IsString()
  @IsOptional()
  description?: string;

  @ApiPropertyOptional({
    example: 'Payment for goods and services',
    description: 'Alternative transaction description field',
  })
  @IsString()
  @IsOptional()
  transactionDesc?: string;

  @ApiPropertyOptional({
    example: 'TXN-20260814-001',
    description: 'Merchant transaction reference for tracking',
  })
  @IsString()
  @IsOptional()
  merchantTransactionReference?: string;

  @ApiPropertyOptional({
    example: 'settlement-123',
    description: 'Settlement ID to link this payment to a settlement',
  })
  @IsString()
  @IsOptional()
  settlementId?: string;

  @ApiPropertyOptional({
    example: 'http://localhost:3000/callbacks/mpesa/token-123',
    description: 'Custom callback URL (overrides default)',
  })
  @IsString()
  @IsOptional()
  callbackUrl?: string;

  @ApiPropertyOptional({
    description: 'Gateway payload for advanced configuration',
  })
  @IsOptional()
  gatewayPayload?: Record<string, any>;

  @ApiPropertyOptional({
    example: '254700000000',
    description: 'Alternative payer phone number field',
  })
  @IsString()
  @IsOptional()
  payerPhoneNumber?: string;
}
