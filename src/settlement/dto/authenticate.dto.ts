import { ApiProperty } from '@nestjs/swagger';
import { IsString, IsNotEmpty } from 'class-validator';

export class AuthenticateDto {
  @ApiProperty({
    example: 'pk_live_abc123',
    description: 'API key issued to the business during onboarding.',
  })
  @IsString()
  @IsNotEmpty()
  apiKey: string = '';

  @ApiProperty({
    example: 'sk_live_xyz789',
    description: 'API secret issued to the business during onboarding.',
  })
  @IsString()
  @IsNotEmpty()
  apiSecret: string = '';
}
