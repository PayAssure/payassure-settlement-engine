import { ApiProperty } from '@nestjs/swagger';
import { IsString } from 'class-validator';

export class LoginDto {
  @ApiProperty({
    example: 'wilfred',
    description: 'The user identifier. This can be either the email address or the username.',
  })
  @IsString()
  identifier!: string;

  @ApiProperty({
    example: '123456',
    description: 'The user password submitted during login.',
  })
  @IsString()
  password!: string;
}
