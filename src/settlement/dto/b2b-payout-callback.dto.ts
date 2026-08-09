import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsString, IsNotEmpty, IsOptional, IsIn, IsNumber } from 'class-validator';

export default class B2bPayoutCallbackDto {
  @ApiProperty({ example: 'TXN-20260703-000001', description: 'Merchant transaction reference from the original settlement.' })
  @IsString()
  @IsNotEmpty()
  merchantTransactionReference: string = '';

  @ApiPropertyOptional({ example: 'SUPPLIER', description: "Payout party: 'SUPPLIER' or 'RETAILER'." })
  @IsOptional()
  @IsString()
  @IsIn(['SUPPLIER', 'RETAILER'])
  party?: string = 'SUPPLIER';

  @ApiPropertyOptional({ example: 'SUP-1001', description: 'Supplier merchant id if applicable.' })
  @IsOptional()
  @IsString()
  supplierMerchantId?: string = '';

  @ApiProperty({ example: 'PAYOUT-REF-1', description: 'Payout reference assigned at dispatch.' })
  @IsString()
  @IsNotEmpty()
  reference: string = '';

  @ApiProperty({ example: 'SUCCESS', description: "Callback status: 'SUCCESS' or 'FAILED' or 'PROCESSING'." })
  @IsString()
  @IsIn(['SUCCESS', 'FAILED', 'PROCESSING'])
  status: string = 'SUCCESS';

  @ApiPropertyOptional({ example: 'GW-12345', description: 'Provider/gateway reference id.' })
  @IsOptional()
  @IsString()
  providerReference?: string = '';

  @ApiPropertyOptional({ example: 'B2B-12345', description: 'Gateway transaction identifier for the payout callback.' })
  @IsOptional()
  @IsString()
  transactionId?: string = '';

  @ApiPropertyOptional({ example: 14850, description: 'Settled amount in smallest currency units (optional).'} )
  @IsOptional()
  @IsNumber()
  amount?: number;

  @ApiPropertyOptional({ description: 'Additional metadata sent by the gateway.' })
  @IsOptional()
  metadata?: Record<string, any> = {};
}
