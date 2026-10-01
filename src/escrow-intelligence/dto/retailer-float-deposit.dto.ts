import { Type } from 'class-transformer';
import { ApiProperty } from '@nestjs/swagger';
import { IsInt, IsPhoneNumber, IsPositive } from 'class-validator';

export class RetailerFloatDepositDto {
  @ApiProperty({ example: 5000, description: 'Amount to request from the payer in KES.' })
  @Type(() => Number)
  @IsInt()
  @IsPositive()
  amount!: number;

  @ApiProperty({ example: '254700000000', description: 'Phone number that will receive the M-Pesa STK prompt.' })
  @IsPhoneNumber('KE')
  payerPhoneNumber!: string;
}