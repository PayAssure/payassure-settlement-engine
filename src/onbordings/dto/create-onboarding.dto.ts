import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { ParticipantType } from '@prisma/client';
import { IsEmail, IsEnum, IsOptional, IsString, ValidateNested } from 'class-validator';
import { Transform, Type } from 'class-transformer';
import { PaymentMethodDto } from './payment-method.dto';

export class CreateOnboardingDto {
  @ApiProperty({ enum: ParticipantType, example: ParticipantType.RETAILER })
  @IsEnum(ParticipantType)
  participantType!: ParticipantType;

  @ApiProperty({ example: 'ABC Supermarket' })
  @IsString()
  businessName!: string;

  @ApiPropertyOptional({ example: 'REG-1001' })
  @Transform(({ value }) => (value === null ? undefined : value))
  @IsOptional()
  @IsString()
  registrationNumber?: string;

  @ApiPropertyOptional({ example: 'A123456789Z' })
  @Transform(({ value }) => (value === null ? undefined : value))
  @IsOptional()
  @IsString()
  kraPin?: string;

  @ApiPropertyOptional({ example: 'Limited Company' })
  @Transform(({ value }) => (value === null ? undefined : value))
  @IsOptional()
  @IsString()
  businessType?: string;

  @ApiPropertyOptional({ example: 'Retail' })
  @Transform(({ value }) => (value === null ? undefined : value))
  @IsOptional()
  @IsString()
  industry?: string;

  @ApiPropertyOptional({ example: 'Nairobi, Kenya' })
  @Transform(({ value }) => (value === null ? undefined : value))
  @IsOptional()
  @IsString()
  physicalAddress?: string;

  @ApiPropertyOptional({ example: 'Jane Doe' })
  @Transform(({ value }) => (value === null ? undefined : value))
  @IsOptional()
  @IsString()
  contactName?: string;

  @ApiPropertyOptional({ example: 'jane@example.com' })
  @Transform(({ value }) => (value === null ? undefined : value))
  @IsOptional()
  @IsEmail()
  email?: string;

  @ApiPropertyOptional({ example: '+254700000000' })
  @Transform(({ value }) => (value === null ? undefined : value))
  @IsOptional()
  @IsString()
  phoneNumber?: string;

  @ApiPropertyOptional({ example: 'BANK' })
  @Transform(({ value }) => (value === null ? undefined : value))
  @IsOptional()
  @IsString()
  settlementMethod?: string;

  @ApiPropertyOptional({ example: '123456789' })
  @Transform(({ value }) => (value === null ? undefined : value))
  @IsOptional()
  @IsString()
  settlementAccount?: string;

  @ApiPropertyOptional({ example: 'Odoo' })
  @Transform(({ value }) => (value === null ? undefined : value))
  @IsOptional()
  @IsString()
  posSystem?: string;

  @ApiPropertyOptional({ example: 'DAILY' })
  @Transform(({ value }) => (value === null ? undefined : value))
  @IsOptional()
  @IsString()
  settlementPreference?: string;

  @ApiPropertyOptional({
    type: PaymentMethodDto,
    description: 'Optional payout destination details for this participant.',
    example: {
      type: 'BANK',
      accountName: 'John Doe',
      isVerified: false,
      bankCode: '07',
      shortcode: '123456',
      accountNumber: '1234567890',
      provider: 'Safaricom',
    },
  })
  @Transform(({ value }) => (value === null ? undefined : value))
  @ValidateNested()
  @Type(() => PaymentMethodDto)
  @IsOptional()
  payment?: PaymentMethodDto;
}
