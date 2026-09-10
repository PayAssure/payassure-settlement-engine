import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { ParticipantStatus, ParticipantType } from '@prisma/client';

export class PublicPaymentResponseDto {
  @ApiProperty({ enum: ['MPESA', 'BANK'] })
  type!: 'MPESA' | 'BANK';

  @ApiProperty()
  accountName!: string;

  @ApiPropertyOptional()
  status?: string;

  @ApiPropertyOptional()
  isVerified?: boolean;

  @ApiPropertyOptional()
  provider?: string;

  @ApiPropertyOptional({ description: 'MPESA phone number. Returned for MPESA payments.' })
  phoneNumber?: string;

  @ApiPropertyOptional({ description: 'Bank code. Returned for BANK payments.' })
  bankCode?: string;

  @ApiPropertyOptional({ description: 'Bank account number. Returned for BANK payments.' })
  accountNumber?: string;

  @ApiPropertyOptional({ description: 'Bank shortcode. Returned for BANK payments when configured.' })
  shortcode?: string;
}

export class PublicIntegrationResponseDto {
  @ApiProperty()
  merchantId!: string;

  @ApiProperty()
  apiKey!: string;

  @ApiProperty()
  apiSecret!: string;

  @ApiProperty()
  environment!: string;

  @ApiProperty()
  isActive!: boolean;
}

export class PublicOnboardingResponseDto {
  @ApiProperty()
  id!: string;

  @ApiProperty({ enum: ParticipantType })
  participantType!: ParticipantType;

  @ApiProperty()
  businessName!: string;

  @ApiPropertyOptional()
  businessType?: string | null;

  @ApiPropertyOptional()
  contactName?: string | null;

  @ApiPropertyOptional()
  email?: string | null;

  @ApiProperty({ enum: ParticipantStatus })
  status!: ParticipantStatus;

  @ApiPropertyOptional({ type: PublicIntegrationResponseDto })
  integration?: PublicIntegrationResponseDto | null;

  @ApiPropertyOptional({ type: PublicPaymentResponseDto })
  payment?: PublicPaymentResponseDto | null;

  @ApiProperty()
  createdAt!: Date;

  @ApiProperty()
  updatedAt!: Date;
}