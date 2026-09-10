import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsNotEmpty, IsOptional, IsString, IsNumber } from 'class-validator';

export default class MpesaCallbackDto {
  @ApiPropertyOptional({
    description: 'M-Pesa callback Body object containing the result',
  })
  @IsOptional()
  Body?: Record<string, any>;

  @ApiPropertyOptional({
    description: 'M-Pesa STK callback result object',
  })
  @IsOptional()
  stkCallback?: Record<string, any>;

  @ApiPropertyOptional({
    example: 0,
    description: 'M-Pesa result code (0 = success)',
  })
  @IsOptional()
  ResultCode?: number;

  @ApiPropertyOptional({
    example: 'The service request has been accepted successfully.',
    description: 'M-Pesa result description',
  })
  @IsString()
  @IsOptional()
  ResultDesc?: string;

  @ApiPropertyOptional({
    description: 'CallbackMetadata containing result details (amount, receipt, reference)',
  })
  @IsOptional()
  CallbackMetadata?: Record<string, any>;

  @ApiPropertyOptional({
    example: 'TXN-20260814-001',
    description: 'Merchant transaction reference (extracted from callback)',
  })
  @IsString()
  @IsOptional()
  merchantTransactionReference?: string;

  @ApiPropertyOptional({
    example: 'SUCCESS',
    description: 'Callback status (SUCCESS or FAILED)',
  })
  @IsString()
  @IsOptional()
  status?: string;

  @ApiPropertyOptional({
    example: 'MPESA',
    description: 'Payment provider name',
  })
  @IsString()
  @IsOptional()
  provider?: string;

  @ApiPropertyOptional({
    example: 1000,
    description: 'Confirmed payment amount',
  })
  @IsNumber()
  @IsOptional()
  amount?: number;

  @ApiPropertyOptional({
    example: '254700000000',
    description: 'Payer phone number',
  })
  @IsString()
  @IsOptional()
  payerPhoneNumber?: string;

  @ApiPropertyOptional({
    example: 'RCPT-001',
    description: 'M-Pesa receipt number',
  })
  @IsString()
  @IsOptional()
  receiptNumber?: string;

  @ApiPropertyOptional({
    example: 'ws_CO_28032023120122793434',
    description: 'Checkout request ID from STK push',
  })
  @IsString()
  @IsOptional()
  checkoutRequestId?: string;

  @ApiPropertyOptional({
    example: '1786728619049',
    description: 'Merchant request ID from STK push',
  })
  @IsString()
  @IsOptional()
  merchantRequestId?: string;

  @ApiPropertyOptional({
    example: '2026-08-14T17:30:19Z',
    description: 'Transaction timestamp',
  })
  @IsString()
  @IsOptional()
  transactionDate?: string;
}
