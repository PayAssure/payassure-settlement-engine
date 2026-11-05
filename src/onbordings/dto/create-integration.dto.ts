import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsOptional, IsString, IsUrl } from 'class-validator';

export class CreateIntegrationDto {
  @ApiPropertyOptional({ example: 'Production' })
  @Transform(({ value }) => (value === null ? undefined : value))
  @IsOptional()
  @IsString()
  environment?: string;

  @ApiPropertyOptional({ example: 'http://localhost:3010/webhook' })
  @Transform(({ value }) => (value === null ? undefined : value))
  @IsOptional()
  @IsUrl({ protocols: ['http', 'https'], require_protocol: true, require_tld: false })
  webhookUrl?: string;
}
