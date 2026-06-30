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

export class SettlementResponseDto {
  @ApiProperty({ example: true })
  success: boolean = false;

  @ApiProperty({ type: Object, example: {
    settlementId: 'settlement_123',
    status: 'INITIATED',
    amount: 5000,
    currency: 'KES',
    reference: 'settlement-001',
    createdAt: '2026-06-30T09:00:00.000Z',
    estimatedProcessingTime: '24-48 hours',
  } })
  settlement: {
    settlementId: string;
    status: SettlementStatus;
    amount: number;
    currency: string;
    reference: string;
    createdAt: Date;
    estimatedProcessingTime?: string;
    transactions?: TransactionResponseDto[];
  } = {
    settlementId: '',
    status: SettlementStatus.INITIATED,
    amount: 0,
    currency: '',
    reference: '',
    createdAt: new Date(),
  };

  @ApiPropertyOptional({ example: 'Settlement request received and queued for processing' })
  message?: string = '';
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
