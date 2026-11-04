import { Type } from 'class-transformer';
import { ApiProperty } from '@nestjs/swagger';
import { IsInt, IsPhoneNumber, IsPositive } from 'class-validator';

export class RetailerFloatDepositDto {
  @ApiProperty({ example: 5000, description: 'Amount to request from the payer in KES.' })
  @Type(() => Number)
  @IsInt()
  @IsPositive()
  amount!: number;

  @ApiProperty({
    example: '254791614036',
    description: 'Kenyan payer phone number that receives the STK prompt; sent to Safaricom as PartyA and PhoneNumber.',
  })
  @IsPhoneNumber('KE')
  payerPhoneNumber!: string;
}