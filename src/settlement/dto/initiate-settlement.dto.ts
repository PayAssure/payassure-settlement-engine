import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsNumber, IsString, IsNotEmpty, IsOptional, IsArray, ValidateNested, Min, IsUrl, IsISO8601, ArrayMinSize, ValidateIf } from 'class-validator';
import { Type } from 'class-transformer';

export class PaymentMethodDto {
  @ApiProperty({ example: 'MPESA', description: 'The payment method type used for this transaction. Supported values are MPESA or CASH.' })
  @IsString()
  @IsNotEmpty()
  type: 'MPESA' | 'CASH' = 'MPESA';

  @ApiProperty({ example: '254712345678', description: 'Phone number for MPESA payout destinations. Required when type is MPESA.' })
  @IsString()
  @IsOptional()
  phoneNumber?: string = '';

  @ApiPropertyOptional({ example: '254712345678', description: 'Deprecated alias kept for backwards compatibility with legacy payloads. Required when type is MPESA.' })
  @IsString()
  @IsOptional()
  payerPhoneNumber?: string = '';

  @ApiPropertyOptional({ example: 'Safaricom', description: 'Payment collection provider. Required only for MPESA. CASH is treated as an escrow-backed collection.' })
  @IsString()
  @IsOptional()
  provider?: 'MPESA' | 'CASH' | 'ESCROW' = 'MPESA';

  @ApiPropertyOptional({ example: 5000, description: 'Optional amount for the current payment method when the settlement is split across multiple funding sources.' })
  @IsNumber()
  @Min(0.0)
  @IsOptional()
  amount?: number = 0;
}

export class PaymentMethodAllocationDto {
  @ApiProperty({ example: 'CASH', description: 'The payment method type used for this funding allocation. Supported values are CASH, MPESA, and BANK.' })
  @IsString()
  @IsNotEmpty()
  type: 'MPESA' | 'CASH' | 'BANK' = 'CASH';

  @ApiProperty({ example: 5000, description: 'Amount funded through this payment method.' })
  @IsNumber()
  @Min(0.01)
  amount: number = 0;

  @ApiPropertyOptional({ example: 'ESCROW', description: 'Provider used for the payment allocation. CASH uses the escrow-backed flow.' })
  @IsString()
  @IsOptional()
  provider?: 'MPESA' | 'CASH' | 'ESCROW' | 'BANK' = 'CASH';

  @ApiPropertyOptional({ example: '254712345678', description: 'Phone number used when this funding allocation is MPESA.' })
  @IsString()
  @IsOptional()
  payerPhoneNumber?: string = '';

  @ApiPropertyOptional({ example: '254712345678', description: 'Legacy phone number field for backwards compatibility with older MPESA payloads.' })
  @IsString()
  @IsOptional()
  phoneNumber?: string = '';
}

export class MerchantPaymentMethodDto {
  @ApiProperty({ example: 'CASH', description: 'Customer funding method. Supported values are CASH and MPESA.' })
  @IsString()
  @IsNotEmpty()
  type: 'MPESA' | 'CASH' = 'CASH';

  @ApiProperty({ example: 45000, description: 'Amount funded through this payment method.' })
  @IsNumber()
  @Min(0.01)
  amount = 0;

  @ApiPropertyOptional({ example: '254791614036', description: 'Customer phone number. Required for MPESA and ignored for CASH.' })
  @IsString()
  @IsOptional()
  phoneNumber?: string;
}

export class MerchantPaymentDto {
  @ApiProperty({ type: [MerchantPaymentMethodDto], description: 'Customer funding methods. Their amounts must sum to amount.' })
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => MerchantPaymentMethodDto)
  methods: MerchantPaymentMethodDto[] = [];
}

export class MerchantSettlementItemDto {
  @ApiProperty({ example: 'pay_supplier_cement_001', description: 'Supplier merchant ID that owns the item.' })
  @IsString()
  @IsNotEmpty()
  supplierMerchantId = '';

  @ApiProperty({ example: 'CEMENT-50KG-001', description: 'Retailer catalog item reference.' })
  @IsString()
  @IsNotEmpty()
  itemReference = '';

  @ApiProperty({ example: 18000, description: 'Amount owed to the supplier for this item. Supplied by the retailer POS/ERP.' })
  @IsNumber()
  @Min(0.01)
  supplierAmount = 0;

  @ApiProperty({ example: 1500, description: 'Retailer commercial amount for this item before the PayAssure fee deduction.' })
  @IsNumber()
  @Min(0.0)
  retailerAmount = 0;

}

export class SupplierItemDto {
  @ApiPropertyOptional({ example: 'ITEM-001', description: 'Reference for the supplier item being settled.' })
  @IsString()
  @IsOptional()
  itemReference?: string = '';

  @ApiPropertyOptional({ example: 'ITEM-001', description: 'Alternative item identifier for the supplier item being settled.' })
  @IsString()
  @IsOptional()
  itemId?: string = '';

  @ApiPropertyOptional({ example: 3200.0, description: 'Amount allocated to the supplier for this item.' })
  @IsNumber()
  @Min(0.01)
  @IsOptional()
  supplierAmount?: number = 0;

  @ApiPropertyOptional({ example: 400.0, description: 'Optional retailer amount allocated for this item.' })
  @IsNumber()
  @Min(0.0)
  @IsOptional()
  retailerAmount?: number = 0;

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

  @ApiPropertyOptional({ type: [SupplierItemDto], description: 'Optional list of item allocations for this supplier group. May be omitted when the payload uses supplier-level totals only.' })
  @IsArray()
  @IsOptional()
  @ValidateNested({ each: true })
  @Type(() => SupplierItemDto)
  items?: SupplierItemDto[] = [];
}

export class InitiateSettlementDto {
  @ApiPropertyOptional({ example: 'pay_d68f568ddc7d7b2a', description: 'Optional merchant identifier for the business initiating the settlement.' })
  @IsString()
  @IsOptional()
  merchantId?: string = '';

  @ApiProperty({ example: 'TXN-20260703-000001', description: 'Merchant transaction reference for the settlement.' })
  @IsString()
  @IsNotEmpty()
  merchantTransactionReference: string = '';

  @ApiProperty({ example: 16500.0, description: 'Total amount for the entire settlement request.' })
  @IsNumber()
  @Min(0.01)
  @ValidateIf((request) => !request.amount)
  totalAmount: number = 0;

  @ApiPropertyOptional({ example: 130280, description: 'Canonical amount alias. New merchant requests should use amount.' })
  @IsNumber()
  @Min(0.01)
  @IsOptional()
  amount?: number;

  @ApiProperty({ example: 'KES', description: 'Currency code for the settlement.' })
  @IsString()
  @IsNotEmpty()
  currency: string = '';

  @ApiProperty({ example: 'BANK_TRANSFER', description: 'Settlement method used for payout.' })
  @IsString()
  @ValidateIf((request) => !request.items)
  @IsNotEmpty()
  @IsOptional()
  settlementMethod: string = '';

  @ApiPropertyOptional({ example: 'Daily settlement batch', description: 'Optional description for the settlement request.' })
  @IsString()
  @IsOptional()
  description?: string = '';

  @ApiPropertyOptional({ type: MerchantPaymentDto, description: 'Canonical payment section. New merchant requests should use payment.methods.' })
  @ValidateNested()
  @Type(() => MerchantPaymentDto)
  @IsOptional()
  payment?: MerchantPaymentDto;

  @ApiPropertyOptional({ type: PaymentMethodDto, description: 'Legacy payment method details. Prefer payment.methods.' })
  @ValidateNested()
  @Type(() => PaymentMethodDto)
  @ValidateIf((request) => !request.payment)
  @IsNotEmpty()
  @IsOptional()
  paymentMethod: PaymentMethodDto = new PaymentMethodDto();

  @ApiPropertyOptional({ type: [PaymentMethodAllocationDto], description: 'Optional list of split funding allocations. Use this for mixed CASH + MPESA settlements. The sum of all allocation amounts must equal totalAmount.' })
  @IsArray()
  @IsOptional()
  @ValidateNested({ each: true })
  @Type(() => PaymentMethodAllocationDto)
  paymentMethods?: PaymentMethodAllocationDto[] = [];

  @ApiPropertyOptional({ example: 'https://merchant.example.com/api/payassure/callback', description: 'Optional callback URL for settlement status notifications.' })
  @IsUrl({ require_tld: false })
  @IsOptional()
  callbackUrl?: string = undefined;

  @ApiPropertyOptional({ example: '2026-07-03T17:30:15+03:00', description: 'Legacy client timestamp. PayAssure server timestamps remain authoritative.' })
  @IsISO8601()
  @ValidateIf((request) => !request.items)
  @IsNotEmpty()
  @IsOptional()
  transactionDate!: string;

  @ApiPropertyOptional({ example: { branchId: 'BR-01', terminalId: 'POS-03' }, description: 'Optional metadata for the transaction.' })
  @IsOptional()
  metadata?: Record<string, any> = {};

  @ApiPropertyOptional({ type: [SupplierDto], description: 'Legacy grouped supplier allocations. New requests should send flat items instead.' })
  @IsArray()
  @ValidateIf((request) => !request.items)
  @ArrayMinSize(1)
  @IsOptional()
  @ValidateNested({ each: true })
  @Type(() => SupplierDto)
  suppliers: SupplierDto[] = [];

  @ApiPropertyOptional({ type: [MerchantSettlementItemDto], description: 'Canonical flat item list. Supplier, retailer, and platform allocations are calculated by PayAssure.' })
  @IsArray()
  @ValidateIf((request) => !request.suppliers || request.suppliers.length === 0)
  @ArrayMinSize(1)
  @IsOptional()
  @ValidateNested({ each: true })
  @Type(() => MerchantSettlementItemDto)
  items?: MerchantSettlementItemDto[];
}
