import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsNumber, IsOptional, IsString, Min } from 'class-validator';

export class RetailerEscrowFloatDto {
  @ApiProperty({ example: 1000, description: 'Configured starting daily float in KES' })
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  dailyFloat: number = 0;

  @ApiPropertyOptional({ example: 'TILL-001', description: 'Retailer till identifier.' })
  @IsOptional()
  @IsString()
  tillNumber?: string;

  @ApiPropertyOptional({ example: 'STORE-001', description: 'Retailer store identifier.' })
  @IsOptional()
  @IsString()
  storeNumber?: string;
}
