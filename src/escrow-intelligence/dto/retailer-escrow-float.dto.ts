import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsNumber, IsOptional, IsString, Min } from 'class-validator';

export class RetailerEscrowFloatDto {
  @ApiProperty({ example: 1000, description: 'Configured starting daily float in KES' })
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  dailyFloat: number = 0;

  @ApiPropertyOptional({
    example: 800,
    description: 'Current expected remaining balance. On initial setup this defaults to dailyFloat; specify it to reset the tracked remainder during an edit.',
  })
  @Type(() => Number)
  @IsOptional()
  @IsNumber()
  @Min(0)
  expectedRemainingBalance?: number;

  @ApiPropertyOptional({ example: 'TILL-001', description: 'Retailer till identifier.' })
  @IsOptional()
  @IsString()
  tillNumber?: string;

  @ApiPropertyOptional({ example: 'STORE-001', description: 'Retailer store identifier.' })
  @IsOptional()
  @IsString()
  storeNumber?: string;
}
