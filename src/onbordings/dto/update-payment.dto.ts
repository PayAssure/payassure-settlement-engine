import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {  IsObject, ValidateNested } from 'class-validator';
import { PaymentMethodDto } from './payment-method.dto';

export class UpdatePaymentDto {
  @ApiProperty({
    type: PaymentMethodDto,
    example: {
      type: 'MPESA',
      accountName: 'John Doe',
      isVerified: true,
      payerPhoneNumber: '254712345678',
      provider: 'Safaricom',
      bankCode: '07',
      accountNumber: '1234567890',
    },
  })
  @ValidateNested()
  @Type(() => PaymentMethodDto)
  @IsObject()
  payment!: PaymentMethodDto;
}
