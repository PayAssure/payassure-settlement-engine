import { ApiProperty } from '@nestjs/swagger';
import { IsString } from 'class-validator';

export class RefreshTokenDto {
  @ApiProperty({
    example: 'refresh-token-here',
    description: 'A valid refresh token previously returned by the login or refresh endpoint.',
  })
  @IsString()
  refreshToken!: string;
}
