import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsNotEmpty, IsOptional, IsString, ValidateNested } from 'class-validator';

class ProviderReferenceDto {
  @ApiPropertyOptional({ example: 'checkout-001', description: 'Checkout request identifier returned by the payment provider.' })
  @IsString()
  @IsOptional()
  checkoutRequestId?: string;

  @ApiPropertyOptional({ example: 'merchant-001', description: 'Merchant request identifier returned by the payment provider.' })
  @IsString()
  @IsOptional()
  merchantRequestId?: string;

  @ApiPropertyOptional({ example: 'RCPT-001', description: 'Provider receipt number for the successful transaction.' })
  @IsString()
  @IsOptional()
  receiptNumber?: string;
}

export default class PaymentConfirmationDto {
  @ApiProperty({ example: 'settlement-123', description: 'Settlement identifier that the payment gateway should confirm.' })
  @IsString()
  @IsNotEmpty()
  settlementId: string = '';

  @ApiPropertyOptional({ example: 'pay-001', description: 'Internal payment identifier from the payment gateway.' })
  @IsString()
  @IsOptional()
  paymentId?: string;

  @ApiProperty({ example: 'PAID', description: 'Confirmation status reported by the payment gateway.' })
  @IsString()
  @IsNotEmpty()
  status: string = 'PAID';

  @ApiPropertyOptional({ example: 'MPESA', description: 'Payment provider that confirmed the payment.' })
  @IsString()
  @IsOptional()
  provider?: string;

  @ApiPropertyOptional({ example: 2000, description: 'Customer-paid amount for the settlement.' })
  @IsOptional()
  paidAmount?: number;

  @ApiPropertyOptional({ example: '2026-07-24T10:00:00.000Z', description: 'Timestamp when the customer completed the payment.' })
  @IsString()
  @IsOptional()
  paidAt?: string;

  @ApiPropertyOptional({ description: 'Provider reference data for the successful transaction.' })
  @IsOptional()
  @ValidateNested()
  providerReference?: ProviderReferenceDto;
}
