import { ApiProperty } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsUrl } from 'class-validator';

export class UpdateWebhookDto {
  @ApiProperty({ example: 'http://localhost:3010/webhook' })
  @Transform(({ value }) => (value === null ? undefined : value))
  @IsUrl({ protocols: ['http', 'https'], require_protocol: true, require_tld: false })
  webhookUrl!: string;
}
