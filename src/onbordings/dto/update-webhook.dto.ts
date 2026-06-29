import { ApiProperty } from '@nestjs/swagger';
import { IsUrl } from 'class-validator';

export class UpdateWebhookDto {
  @ApiProperty({ example: 'https://example.com/webhook' })
  @IsUrl()
  webhookUrl!: string;
}
