import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { ParticipantStatus, ParticipantType } from '@prisma/client';
import { PaymentMethodDto } from './payment-method.dto';

export class IntegrationResponseDto {
  @ApiProperty()
  id!: string;

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

  @ApiProperty()
  createdAt!: Date;
}

export class OnboardingResponseDto {
  @ApiPropertyOptional()
  message?: string;

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

  @ApiPropertyOptional({ type: IntegrationResponseDto })
  integration?: IntegrationResponseDto | null;

  @ApiPropertyOptional({ type: PaymentMethodDto, description: 'Configured payout destination for this participant.' })
  payment?: PaymentMethodDto | null;

  @ApiProperty()
  createdAt!: Date;

  @ApiProperty()
  updatedAt!: Date;
}
