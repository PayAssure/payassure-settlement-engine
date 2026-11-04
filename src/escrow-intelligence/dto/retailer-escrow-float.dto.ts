import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsNumber, Min } from 'class-validator';

export class RetailerEscrowFloatDto {
  @ApiProperty({ example: 1000, description: 'Configured starting daily float in KES' })
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  dailyFloat: number = 0;
}
