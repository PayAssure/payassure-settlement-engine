import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString } from 'class-validator';

export class ActivatePaymentDto {
  @ApiProperty({ example: 'paysec_7f3c9a2b6d...', description: 'Payment activation secret issued during payout destination setup.' })
  @IsNotEmpty()
  @IsString()
  paymentActivationSecret!: string;
}
