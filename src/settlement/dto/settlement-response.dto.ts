import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { SettlementStatus, TransactionStatus } from '@prisma/client';

export class BusinessDto {
  @ApiProperty({ example: 'business_123' })
  id: string = '';

  @ApiProperty({ example: 'ABC Supermarket' })
  businessName: string = '';

  @ApiProperty({ example: 'RETAILER' })
  participantType: string = '';

  @ApiProperty({ example: 'LIVE' })
  status: string = '';
}

export class AuthenticateResponseDto {
  @ApiProperty({ example: true })
  success: boolean = false;

  @ApiProperty({ example: 'one_time_abc123' })
  token: string = '';

  @ApiProperty({ example: 3600 })
  expiresIn: number = 0;

  @ApiProperty({ example: 'Bearer' })
  tokenType: string = '';

  @ApiProperty({ type: BusinessDto })
  business: BusinessDto = new BusinessDto();
}

export class TransactionResponseDto {
  @ApiProperty({ example: 'txn_001' })
  transactionId: string = '';

  @ApiProperty({ example: 'item_001' })
  itemId: string = '';

  @ApiProperty({ example: 'SALE' })
  type: string = '';

  @ApiProperty({ example: 2500 })
  amount: number = 0;

  @ApiPropertyOptional({ example: 'Sales for 2026-06-30' })
  description?: string = '';

  @ApiProperty({ enum: TransactionStatus, example: TransactionStatus.INITIATED })
  status: TransactionStatus = TransactionStatus.INITIATED;
}

export class PaymentResponseDto {
  @ApiProperty({ example: 'MPESA', description: 'Payment type for the displayed payment details.' })
  type: string = '';

  @ApiPropertyOptional({ example: 'John Doe', description: 'Optional account or beneficiary name for the payout destination.' })
  accountName?: string = '';

  @ApiPropertyOptional({ example: 'Safaricom', description: 'Optional payment provider or network name.' })
  provider?: string = '';

  @ApiPropertyOptional({ example: '254712345678', description: 'M-Pesa phone number for MPESA payouts.' })
  payerPhoneNumber?: string = '';

  @ApiPropertyOptional({ example: '07', description: 'Bank code for BANK payouts.' })
  bankCode?: string = '';

  @ApiPropertyOptional({ example: '1234567890', description: 'Bank account number for BANK payouts.' })
  accountNumber?: string = '';
}

export class SettlementPartyDetailsDto {
  @ApiProperty({ example: 15000, description: 'Amount allocated to this party in the child settlement.' })
  amount: number = 0;

  @ApiPropertyOptional({ type: PaymentResponseDto, description: 'Relevant payment details for this party.' })
  paymentDetails?: PaymentResponseDto = undefined;
}

export class SupplierSettlementChildDto {
  @ApiProperty({ example: 'settlement_456', description: 'Identifier for the child settlement record.' })
  id: string = '';

  @ApiProperty({ example: 'settlement-001-pay_sup_001', description: 'Child settlement reference for this supplier group.' })
  reference: string = '';

  @ApiProperty({ type: SettlementPartyDetailsDto, description: 'Supplier-specific settlement amount and payment details.' })
  supplier: SettlementPartyDetailsDto = new SettlementPartyDetailsDto();

  @ApiProperty({ type: SettlementPartyDetailsDto, description: 'Retailer-specific settlement amount and payment details.' })
  retailer: SettlementPartyDetailsDto = new SettlementPartyDetailsDto();

  @ApiProperty({ example: 1000, description: 'System fee or platform amount retained for this child settlement.' })
  systemAmount: number = 0;

  @ApiProperty({ example: 16500, description: 'Total amount covered by this child settlement, including supplier, retailer, and system allocations.' })
  amount: number = 0;
}

export class SettlementResponseDto {
  @ApiProperty({ example: true })
  success: boolean = false;

  @ApiProperty({ type: Object, example: {
    settlementId: 'settlement_123',
    merchantId: 'pay_d68f568ddc7d7b2a',
    status: 'INITIATED',
    amount: 16500,
    retailerAmount: 500,
    supplierAmount: 15000,
    systemAmount: 1500,
    paymentDetails: { type: 'MPESA', payerPhoneNumber: '254712345678', provider: 'Safaricom' },
    currency: 'KES',
    reference: 'settlement-001',
    createdAt: '2026-06-30T09:00:00.000Z',
    estimatedProcessingTime: '24-48 hours',
  } })
  settlement: {
    settlementId: string;
    merchantId: string;
    status: SettlementStatus;
    amount: number;
    retailerAmount: number;
    supplierAmount: number;
    systemAmount: number;
    paymentDetails: PaymentResponseDto;
    currency: string;
    reference: string;
    createdAt: Date;
    estimatedProcessingTime?: string;
    transactions?: TransactionResponseDto[];
  } = {
    settlementId: '',
    merchantId: '',
    status: SettlementStatus.INITIATED,
    amount: 0,
    retailerAmount: 0,
    supplierAmount: 0,
    systemAmount: 0,
    paymentDetails: new PaymentResponseDto(),
    currency: '',
    reference: '',
    createdAt: new Date(),
  };

  @ApiPropertyOptional({ example: 'Settlement request received and queued for processing' })
  message?: string = '';

  @ApiPropertyOptional({ type: [SupplierSettlementChildDto], description: 'Optional child settlements created for each supplier group.' })
  children?: SupplierSettlementChildDto[] = [];
}

export class TrackSettlementResponseDto {
  @ApiProperty({ example: true })
  success: boolean = false;

  @ApiProperty({ type: Object, example: {
    settlementId: 'settlement_123',
    businessId: 'business_123',
    businessName: 'ABC Supermarket',
    status: 'PROCESSING',
    amount: 5000,
    currency: 'KES',
    reference: 'settlement-001',
    createdAt: '2026-06-30T09:00:00.000Z',
    transactions: [],
  } })
  settlement: {
    settlementId: string;
    businessId: string;
    businessName?: string;
    status: SettlementStatus;
    amount: number;
    currency: string;
    reference: string;
    createdAt: Date;
    processedAt?: Date;
    estimatedCompletionTime?: Date;
    transactions: TransactionResponseDto[];
  } = {
    settlementId: '',
    businessId: '',
    status: SettlementStatus.INITIATED,
    amount: 0,
    currency: '',
    reference: '',
    createdAt: new Date(),
    transactions: [],
  };
}

export class ReconcileResponseDto {
  @ApiProperty({ example: true })
  success: boolean = false;

  @ApiProperty({ type: Object, example: {
    settlementId: 'settlement_123',
    status: 'COMPLETED',
    reconciliationStatus: 'VERIFIED',
    reconciliationDetails: {
      bankReference: 'BANK_REF_001',
      reconcileAt: '2026-06-30T09:30:00.000Z',
    },
  } })
  settlement: {
    settlementId: string;
    status: SettlementStatus;
    reconciliationStatus?: string;
    reconciliationDetails?: {
      bankReference: string;
      reconcileAt: Date;
    };
  } = {
    settlementId: '',
    status: SettlementStatus.INITIATED,
  };
}

export class ErrorResponseDto {
  @ApiProperty({ example: 400 })
  statusCode: number = 0;

  @ApiProperty({ example: 'Validation failed' })
  message: string = '';

  @ApiProperty({ example: 'VALIDATION_ERROR' })
  error: string = '';

  @ApiPropertyOptional({ type: Object, example: [{ field: 'amount', message: 'Amount must be greater than 0' }] })
  errors?: Array<{
    field: string;
    message: string;
  }> = [];
}
