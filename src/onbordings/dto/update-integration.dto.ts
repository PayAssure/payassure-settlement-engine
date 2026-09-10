import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsBoolean, IsOptional, IsString, IsUrl } from 'class-validator';

export class UpdateIntegrationDto {
  @ApiPropertyOptional({ example: 'Production' })
  @Transform(({ value }) => (value === null ? undefined : value))
  @IsOptional()
  @IsString()
  environment?: string;

  @ApiPropertyOptional({ example: 'https://example.com/webhook' })
  @Transform(({ value }) => (value === null ? undefined : value))
  @IsOptional()
  @IsUrl()
  webhookUrl?: string;

  @ApiPropertyOptional({ example: true })
  @Transform(({ value }) => (value === null ? undefined : value))
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}
