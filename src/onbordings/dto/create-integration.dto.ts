import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, IsUrl } from 'class-validator';

export class CreateIntegrationDto {
  @ApiPropertyOptional({ example: 'Production' })
  @IsOptional()
  @IsString()
  environment?: string;

  @ApiPropertyOptional({ example: 'https://example.com/webhook' })
  @IsOptional()
  @IsUrl()
  webhookUrl?: string;
}
