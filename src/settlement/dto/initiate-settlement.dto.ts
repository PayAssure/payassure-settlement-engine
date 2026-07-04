import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsNumber, IsString, IsNotEmpty, IsOptional, IsArray, ValidateNested, Min, IsUrl, IsISO8601 } from 'class-validator';
import { Type } from 'class-transformer';

export class PaymentMethodDto {
  @ApiProperty({ example: 'MPESA', description: 'The payment method type used for this transaction.' })
  @IsString()
  @IsNotEmpty()
  type: string = '';

  @ApiProperty({ example: '254712345678', description: 'Payer phone number or payment identifier.' })
  @IsString()
  @IsNotEmpty()
  payerPhoneNumber: string = '';

  @ApiPropertyOptional({ example: 'Safaricom', description: 'Optional payment provider or network name.' })
  @IsString()
  @IsOptional()
  provider?: string = '';
}

export class SupplierItemDto {
  @ApiProperty({ example: 'ITEM-001', description: 'Unique item identifier for this supplier item.' })
  @IsString()
  @IsNotEmpty()
  itemId: string = '';

  @ApiPropertyOptional({ example: 'Cement 50kg', description: 'Optional human-friendly item name.' })
  @IsString()
  @IsOptional()
  itemName?: string = '';

  @ApiProperty({ example: 3200.0, description: 'Amount allocated to the supplier for this item.' })
  @IsNumber()
  @Min(0.01)
  supplierAmount: number = 0;

  @ApiPropertyOptional({ example: 400.0, description: 'Amount allocated to the retailer for this item.' })
  @IsNumber()
  @Min(0.0)
  @IsOptional()
  retailerAmount?: number = 0;

  @ApiPropertyOptional({ example: 28.8, description: 'Platform fee allocated to this item.' })
  @IsNumber()
  @Min(0.0)
  @IsOptional()
  platformFee?: number = 0;

  @ApiPropertyOptional({ example: 5, description: 'Optional item quantity for reporting.' })
  @IsNumber()
  @Min(0.01)
  @IsOptional()
  quantity?: number = 0;

  @ApiPropertyOptional({ example: 640.0, description: 'Optional per-unit price for this item.' })
  @IsNumber()
  @Min(0.0)
  @IsOptional()
  unitPrice?: number = 0;

  @ApiPropertyOptional({ example: 'Cement sale', description: 'Optional description for this supplier item.' })
  @IsString()
  @IsOptional()
  description?: string = '';
}

export class SupplierDto {
  @ApiProperty({ example: 'SUP-1001', description: 'Merchant identifier of the supplier for this settlement group.' })
  @IsString()
  @IsNotEmpty()
  supplierMerchantId: string = '';

  @ApiPropertyOptional({ example: 7200.0, description: 'Optional total amount for this supplier. PayAssure will verify this against item allocations.' })
  @IsNumber()
  @Min(0.0)
  @IsOptional()
  supplierTotalAmount?: number = 0;

  @ApiPropertyOptional({ example: 900.0, description: 'Optional total amount allocated to the retailer for this supplier group.' })
  @IsNumber()
  @Min(0.0)
  @IsOptional()
  retailerTotalAmount?: number = 0;

  @ApiPropertyOptional({ example: 64.8, description: 'Optional platform fee amount for this supplier group.' })
  @IsNumber()
  @Min(0.0)
  @IsOptional()
  platformFee?: number = 0;

  @ApiProperty({ type: [SupplierItemDto], description: 'List of item allocations for this supplier group.' })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => SupplierItemDto)
  items: SupplierItemDto[] = [];
}

export class TransactionItemDto {
  @ApiProperty({ example: 'item_001', description: 'Unique item identifier for this transaction.' })
  @IsString()
  @IsNotEmpty()
  itemId: string = '';

  @ApiProperty({ example: 'pay_sup_001', description: 'Merchant identifier of the supplier that owns this item.' })
  @IsString()
  @IsNotEmpty()
  supplierMerchantId: string = '';

  @ApiProperty({ example: 'SALE', description: 'Type of transaction such as SALE, REFUND, or ADJUSTMENT.' })
  @IsString()
  @IsNotEmpty()
  type: string = '';

  @ApiProperty({ example: 5, description: 'Quantity of the item being settled.' })
  @IsNumber()
  @Min(0.01)
  quantity: number = 0;

  @ApiProperty({ example: 500, description: 'Unit price per item.' })
  @IsNumber()
  @Min(0.01)
  unitPrice: number = 0;

  @ApiProperty({ example: 2500, description: 'Amount for the transaction item.' })
  @IsNumber()
  @Min(0.01)
  amount: number = 0;

  @ApiPropertyOptional({ example: 'Sales for 2026-06-30', description: 'Optional description of the transaction item.' })
  @IsString()
  @IsOptional()
  description?: string = '';
}

export class InitiateSettlementDto {
  @ApiProperty({ example: 'TXN-20260703-000001', description: 'Merchant transaction reference for the settlement.' })
  @IsString()
  @IsNotEmpty()
  merchantTransactionReference: string = '';

  @ApiProperty({ example: 16500.0, description: 'Total amount for the entire settlement request.' })
  @IsNumber()
  @Min(0.01)
  totalAmount: number = 0;

  @ApiProperty({ example: 'KES', description: 'Currency code for the settlement.' })
  @IsString()
  @IsNotEmpty()
  currency: string = '';

  @ApiProperty({ example: 'BANK_TRANSFER', description: 'Settlement method used for payout.' })
  @IsString()
  @IsNotEmpty()
  settlementMethod: string = '';

  @ApiPropertyOptional({ example: 'Daily settlement batch', description: 'Optional description for the settlement request.' })
  @IsString()
  @IsOptional()
  description?: string = '';

  @ApiProperty({ type: PaymentMethodDto, description: 'Payment method details for the settlement.' })
  @ValidateNested()
  @Type(() => PaymentMethodDto)
  paymentMethod: PaymentMethodDto = new PaymentMethodDto();

  @ApiPropertyOptional({ example: 'https://merchant.example.com/api/payassure/callback', description: 'Optional callback URL for settlement status notifications.' })
  @IsUrl()
  @IsOptional()
  callbackUrl?: string = '';

  @ApiProperty({ example: '2026-07-03T17:30:15+03:00', description: 'ISO timestamp for when the transaction occurred.' })
  @IsISO8601()
  transactionDate: string = '';

  @ApiPropertyOptional({ example: { branchId: 'BR-01', terminalId: 'POS-03' }, description: 'Optional metadata for the transaction.' })
  @IsOptional()
  metadata?: Record<string, any> = {};

  @ApiProperty({ type: [SupplierDto], description: 'Supplier-based allocations representing settlement units.' })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => SupplierDto)
  suppliers: SupplierDto[] = [];
}
