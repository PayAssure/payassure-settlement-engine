import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsOptional, IsString, IsUrl } from 'class-validator';

export class CreateIntegrationDto {
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
}
