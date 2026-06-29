import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { ParticipantType } from '@prisma/client';
import { IsEmail, IsEnum, IsOptional, IsString } from 'class-validator';

export class CreateOnboardingDto {
  @ApiProperty({ enum: ParticipantType, example: ParticipantType.RETAILER })
  @IsEnum(ParticipantType)
  participantType!: ParticipantType;

  @ApiProperty({ example: 'ABC Supermarket' })
  @IsString()
  businessName!: string;

  @ApiPropertyOptional({ example: 'REG-1001' })
  @IsOptional()
  @IsString()
  registrationNumber?: string;

  @ApiPropertyOptional({ example: 'A123456789Z' })
  @IsOptional()
  @IsString()
  kraPin?: string;

  @ApiPropertyOptional({ example: 'Limited Company' })
  @IsOptional()
  @IsString()
  businessType?: string;

  @ApiPropertyOptional({ example: 'Retail' })
  @IsOptional()
  @IsString()
  industry?: string;

  @ApiPropertyOptional({ example: 'Nairobi, Kenya' })
  @IsOptional()
  @IsString()
  physicalAddress?: string;

  @ApiPropertyOptional({ example: 'Jane Doe' })
  @IsOptional()
  @IsString()
  contactName?: string;

  @ApiPropertyOptional({ example: 'jane@example.com' })
  @IsOptional()
  @IsEmail()
  email?: string;

  @ApiPropertyOptional({ example: '+254700000000' })
  @IsOptional()
  @IsString()
  phoneNumber?: string;

  @ApiPropertyOptional({ example: 'BANK' })
  @IsOptional()
  @IsString()
  settlementMethod?: string;

  @ApiPropertyOptional({ example: '123456789' })
  @IsOptional()
  @IsString()
  settlementAccount?: string;

  @ApiPropertyOptional({ example: 'Odoo' })
  @IsOptional()
  @IsString()
  posSystem?: string;

  @ApiPropertyOptional({ example: 'DAILY' })
  @IsOptional()
  @IsString()
  settlementPreference?: string;
}
