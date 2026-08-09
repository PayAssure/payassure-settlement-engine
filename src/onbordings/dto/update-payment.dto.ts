import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {  IsObject, ValidateNested } from 'class-validator';
import { PaymentMethodDto } from './payment-method.dto';

export class UpdatePaymentDto {
  @ApiProperty({
    type: PaymentMethodDto,
    example: {
      type: 'BANK',
      accountName: 'John Doe',
      bankCode: '07',
      shortcode: '123456',
      accountNumber: '1234567890',
      provider: 'Safaricom',
    },
  })
  @ValidateNested()
  @Type(() => PaymentMethodDto)
  @IsObject()
  payment!: PaymentMethodDto;
}
