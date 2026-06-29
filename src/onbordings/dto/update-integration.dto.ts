import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsOptional, IsString, IsUrl } from 'class-validator';

export class UpdateIntegrationDto {
  @ApiPropertyOptional({ example: 'Production' })
  @IsOptional()
  @IsString()
  environment?: string;

  @ApiPropertyOptional({ example: 'https://example.com/webhook' })
  @IsOptional()
  @IsUrl()
  webhookUrl?: string;

  @ApiPropertyOptional({ example: true })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}
