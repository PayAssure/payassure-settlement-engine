import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsNotEmpty, IsOptional, IsString } from 'class-validator';

export  default class PaymentCallbackDto {
  @ApiProperty({ example: 'TXN-20260703-000001', description: 'Merchant transaction reference tied to the settlement.' })
  @IsString()
  @IsNotEmpty()
  merchantTransactionReference: string = '';

  @ApiPropertyOptional({ example: 'SUCCESS', description: 'Callback status reported by the payment provider.' })
  @IsString()
  @IsOptional()
  status?: string = 'SUCCESS';

  @ApiPropertyOptional({ example: 'M-PESA', description: 'Provider that delivered the callback.' })
  @IsString()
  @IsOptional()
  provider?: string = '';

  @ApiPropertyOptional({ example: 'MPESA-12345', description: 'Provider transaction identifier.' })
  @IsString()
  @IsOptional()
  providerReference?: string = '';

  @ApiPropertyOptional({ example: 16500, description: 'Confirmed payment amount.' })
  @IsOptional()
  amount?: number;

  @ApiPropertyOptional({ example: 'KES', description: 'Currency for the confirmed payment.' })
  @IsString()
  @IsOptional()
  currency?: string = '';

  @ApiPropertyOptional({ description: 'Any additional provider metadata.' })
  @IsOptional()
  metadata?: Record<string, any> = {};
}
