import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsString, IsOptional, IsIn, IsNumber } from 'class-validator';

/**
 * B2B Payout Callback DTO
 * 
 * Accepts M-Pesa callback in format:
 * { Result: { ResultCode, ResultDesc, TransactionID, ... } }
 * 
 * The MpesaCallbackTransformPipe transforms it to our flat format.
 */
export default class B2bPayoutCallbackDto {
  @ApiProperty({ example: 'TXN-20260703-000001', description: 'Merchant transaction reference from the original settlement.' })
  @IsOptional()
  @IsString()
  merchantTransactionReference?: string;

  @ApiPropertyOptional({ example: 'SUPPLIER', description: "Payout party: 'SUPPLIER' or 'RETAILER'." })
  @IsOptional()
  @IsString()
  @IsIn(['SUPPLIER', 'RETAILER'])
  party?: string;

  @ApiPropertyOptional({ example: 'SUP-1001', description: 'Supplier merchant id if applicable.' })
  @IsOptional()
  @IsString()
  supplierMerchantId?: string;

  @ApiProperty({ example: 'PAYOUT-REF-1', description: 'Payout reference assigned at dispatch.' })
  @IsOptional()
  @IsString()
  reference?: string;

  @ApiProperty({ example: 'SUCCESS', description: "Callback status: 'SUCCESS' or 'FAILED'." })
  @IsOptional()
  @IsString()
  @IsIn(['SUCCESS', 'FAILED', 'PROCESSING'])
  status?: string;

  @ApiPropertyOptional({ example: 'GW-12345', description: 'Provider/gateway reference id.' })
  @IsOptional()
  @IsString()
  providerReference?: string;

  @ApiPropertyOptional({ example: 'UHHRY0DHFK', description: 'M-Pesa transaction ID.' })
  @IsOptional()
  @IsString()
  transactionId?: string;

  @ApiPropertyOptional({ example: 14850, description: 'Settled amount in smallest currency units (optional).'} )
  @IsOptional()
  @IsNumber()
  amount?: number;

  @ApiPropertyOptional({ description: 'Additional metadata sent by the gateway.' })
  @IsOptional()
  metadata?: Record<string, any>;

  // M-Pesa specific fields
  @ApiPropertyOptional({ description: 'Result code from M-Pesa (0=success)' })
  @IsOptional()
  resultCode?: number;

  @ApiPropertyOptional({ description: 'Result description from M-Pesa' })
  @IsOptional()
  @IsString()
  resultDescription?: string;

  @ApiPropertyOptional({ description: 'Conversation ID from M-Pesa' })
  @IsOptional()
  @IsString()
  conversationId?: string;

  @ApiPropertyOptional({ description: 'Originator conversation ID from M-Pesa' })
  @IsOptional()
  @IsString()
  originatorConversationId?: string;

  @ApiPropertyOptional({ description: 'Full M-Pesa Result object (when sent as nested)' })
  @IsOptional()
  Result?: any;
}
