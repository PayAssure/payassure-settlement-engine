import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsNumber, IsString, IsNotEmpty, IsOptional, IsArray, ValidateNested, Min } from 'class-validator';
import { Type } from 'class-transformer';

export class TransactionItemDto {
  @ApiProperty({ example: 'item_001', description: 'Unique item identifier for this transaction.' })
  @IsString()
  @IsNotEmpty()
  itemId: string = '';

  @ApiProperty({ example: 'SALE', description: 'Type of transaction such as SALE, REFUND, or ADJUSTMENT.' })
  @IsString()
  @IsNotEmpty()
  type: string = '';

  @ApiProperty({ example: 2500, description: 'Amount for the transaction item.' })
  @IsNumber()
  @Min(0)
  amount: number = 0;

  @ApiPropertyOptional({ example: 'Sales for 2026-06-30', description: 'Optional description of the transaction item.' })
  @IsString()
  @IsOptional()
  description?: string = '';
}

export class InitiateSettlementDto {
  @ApiProperty({ example: 5000, description: 'Total settlement amount requested.' })
  @IsNumber()
  @Min(0.01)
  amount: number = 0;

  @ApiProperty({ example: 'KES', description: 'Settlement currency code.' })
  @IsString()
  @IsNotEmpty()
  currency: string = '';

  @ApiProperty({ example: 'BANK_TRANSFER', description: 'Settlement method used for payout.' })
  @IsString()
  @IsNotEmpty()
  settlementMethod: string = '';

  @ApiProperty({ example: '1234567890', description: 'Destination account or payout reference.' })
  @IsString()
  @IsNotEmpty()
  settlementAccount: string = '';

  @ApiProperty({ example: 'settlement-001', description: 'Unique settlement reference from the caller.' })
  @IsString()
  @IsNotEmpty()
  reference: string = '';

  @ApiPropertyOptional({ example: 'Daily settlement batch', description: 'Optional description for the settlement request.' })
  @IsString()
  @IsOptional()
  description?: string = '';

  @ApiPropertyOptional({ type: [TransactionItemDto], description: 'Optional list of transaction items included in the settlement.' })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => TransactionItemDto)
  @IsOptional()
  transactionItems?: TransactionItemDto[] = [];

  @ApiPropertyOptional({ example: { source: 'pos-system' }, description: 'Optional metadata about the settlement request.' })
  @IsOptional()
  metadata?: Record<string, any> = {};
}
