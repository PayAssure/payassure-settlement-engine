import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsBoolean, IsIn, IsNotEmpty, IsOptional, IsString, Matches, ValidateIf } from 'class-validator';

export type PaymentVerificationStatus = 'PENDING_VERIFICATION' | 'VERIFIED' | 'FAILED' | 'SUSPENDED' | 'DISABLED';

export class PaymentMethodDto {
  @ApiProperty({ example: 'MPESA', description: 'Payout method type. Only one payout destination may be configured at a time.' })
  @IsIn(['MPESA', 'BANK'])
  type!: 'MPESA' | 'BANK';

  @ApiProperty({ example: 'John Doe', description: 'Account or beneficiary name for payout verification.' })
  @IsNotEmpty()
  @IsString()
  accountName!: string;

  @ApiPropertyOptional({ readOnly: true, example: 'PENDING_VERIFICATION', description: 'Backend-managed lifecycle status for the payout destination.' })
  @Transform(({ value }) => (value === null ? undefined : value))
  @IsOptional()
  @IsString()
  status?: PaymentVerificationStatus;

  @ApiPropertyOptional({ readOnly: true, example: false, description: 'Backend-managed verification state for the payout destination.' })
  @Transform(({ value }) => (value === null ? undefined : value))
  @IsOptional()
  @IsBoolean()
  isVerified?: boolean;

  @ApiPropertyOptional({ example: '254712345678', description: 'Phone number for MPESA payouts.' })
  @Transform(({ value }) => (value === null ? undefined : value))
  @ValidateIf((o) => o.type === 'MPESA')
  @IsNotEmpty()
  @IsString()
  phoneNumber?: string;

  @ApiPropertyOptional({ example: '254712345678', description: 'Deprecated alias retained for backwards compatibility.' })
  @Transform(({ value }) => (value === null ? undefined : value))
  @ValidateIf((o) => o.type === 'MPESA')
  @IsOptional()
  @IsString()
  payerPhoneNumber?: string;

  @ApiPropertyOptional({ example: 'Safaricom', description: 'Optional payment provider or network name.' })
  @Transform(({ value }) => (value === null ? undefined : value))
  @IsOptional()
  @IsString()
  provider?: string;

  @ApiPropertyOptional({ example: '123456', description: 'Optional shortcode for BANK payout destinations. Must contain digits only.' })
  @Transform(({ value }) => (value === null ? undefined : value))
  @ValidateIf((o) => o.type === 'BANK')
  @IsOptional()
  @IsString()
  @Matches(/^[0-9]+$/, { message: 'shortcode must contain only digits' })
  shortcode?: string;

  @ApiPropertyOptional({ example: '07', description: 'Bank code for BANK payouts.' })
  @Transform(({ value }) => (value === null ? undefined : value))
  @ValidateIf((o) => o.type === 'BANK')
  @IsNotEmpty()
  @IsString()
  bankCode?: string;

  @ApiPropertyOptional({ example: '1234567890', description: 'Bank account number for BANK payouts.' })
  @Transform(({ value }) => (value === null ? undefined : value))
  @ValidateIf((o) => o.type === 'BANK')
  @IsNotEmpty()
  @IsString()
  accountNumber?: string;

  @ApiPropertyOptional({ example: 'paysec_7f3c9a2b6d...', description: 'Raw activation secret returned to the merchant for the pending verification flow.' })
  @Transform(({ value }) => (value === null ? undefined : value))
  @IsOptional()
  @IsString()
  paymentActivationSecret?: string;

  @ApiPropertyOptional({ example: 'paysec_7f3c9a2b6d...', description: 'Hashed activation secret for the pending verification flow.' })
  @Transform(({ value }) => (value === null ? undefined : value))
  @IsOptional()
  @IsString()
  paymentActivationSecretHash?: string;

  @ApiPropertyOptional({ example: '2026-07-05T12:00:00.000Z', description: 'Expiry time for the payment activation secret.' })
  @Transform(({ value }) => (value === null ? undefined : value))
  @IsOptional()
  @IsString()
  paymentActivationSecretExpiresAt?: string;

  @ApiPropertyOptional({ example: 0, description: 'How many times the activation secret has been attempted.' })
  @Transform(({ value }) => (value === null ? undefined : value))
  @IsOptional()
  verificationAttempts?: number;

  @ApiPropertyOptional({ example: 'PAYMENT_ACTIVATION_SECRET', description: 'Verification method used to confirm ownership.' })
  @Transform(({ value }) => (value === null ? undefined : value))
  @IsOptional()
  @IsString()
  verificationMethod?: string;

  @ApiPropertyOptional({ example: '2026-07-05T12:00:00.000Z', description: 'Timestamp when the payout destination was verified.' })
  @Transform(({ value }) => (value === null ? undefined : value))
  @IsOptional()
  @IsString()
  verifiedAt?: string;
}
