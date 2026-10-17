import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, IsPositive } from 'class-validator';

export class RetailerEscrowTransferDto {
  @ApiProperty({ example: 5000, description: 'Amount to transfer from the retailer escrow account to the PayAssure M-Pesa account, in KES.' })
  @Type(() => Number)
  @IsInt()
  @IsPositive()
  amount!: number;
}
