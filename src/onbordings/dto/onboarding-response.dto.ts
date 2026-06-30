import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { ParticipantStatus, ParticipantType } from '@prisma/client';

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

  @ApiProperty()
  createdAt!: Date;

  @ApiProperty()
  updatedAt!: Date;
}
