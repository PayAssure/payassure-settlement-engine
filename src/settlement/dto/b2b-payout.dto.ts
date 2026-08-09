import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsNotEmpty, IsOptional, IsString, IsNumber, IsIn } from 'class-validator';

export default class B2bPayoutDispatchDto {
  @ApiProperty({ example: 'TXN-20260703-000001', description: 'Merchant transaction reference tied to the settlement.' })
  @IsString()
  @IsNotEmpty()
  merchantTransactionReference: string = '';

  @ApiPropertyOptional({ example: 'SUPPLIER', description: "Payout party: 'SUPPLIER' or 'RETAILER'." })
  @IsOptional()
  @IsString()
  @IsIn(['SUPPLIER', 'RETAILER'])
  party?: string = 'SUPPLIER';

  @ApiPropertyOptional({ example: 'SUP-1001', description: 'Supplier merchant id for supplier payouts.' })
  @IsOptional()
  @IsString()
  supplierMerchantId?: string = '';

  @ApiPropertyOptional({ example: 14850, description: 'Amount to send in smallest currency units.' })
  @IsOptional()
  @IsNumber()
  amount?: number = 0;

  @ApiPropertyOptional({ example: 'PAYOUT-REF-1', description: 'Optional payout reference for tracing.' })
  @IsOptional()
  @IsString()
  payoutReference?: string = '';

  @ApiPropertyOptional({ description: 'Optional metadata to attach to the dispatch request.' })
  @IsOptional()
  metadata?: Record<string, any> = {};
}
