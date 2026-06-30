import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsString, IsNotEmpty, IsOptional } from 'class-validator';

export class ReconcileSettlementDto {
  @ApiProperty({ example: 'settlement_123', description: 'Settlement identifier to reconcile.' })
  @IsString()
  @IsNotEmpty()
  settlementId: string = '';

  @ApiProperty({ example: 'BANK_REF_001', description: 'Bank reference returned by the financial institution.' })
  @IsString()
  @IsNotEmpty()
  bankReference: string = '';

  @ApiPropertyOptional({ example: 'txn_987654', description: 'Optional bank transaction identifier.' })
  @IsString()
  @IsOptional()
  bankTransactionId?: string = '';

  @ApiPropertyOptional({ example: 'Settlement completed successfully.', description: 'Optional reconciliation note.' })
  @IsString()
  @IsOptional()
  notes?: string = '';
}
