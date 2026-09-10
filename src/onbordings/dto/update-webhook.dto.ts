import { ApiProperty } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsUrl } from 'class-validator';

export class UpdateWebhookDto {
  @ApiProperty({ example: 'https://example.com/webhook' })
  @Transform(({ value }) => (value === null ? undefined : value))
  @IsUrl()
  webhookUrl!: string;
}
