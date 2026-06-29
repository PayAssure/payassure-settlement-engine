import { ApiProperty } from '@nestjs/swagger';

export class AuthResponseDto {
  @ApiProperty({
    example: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...',
    description: 'JWT access token used to authenticate protected API requests.',
  })
  accessToken!: string;

  @ApiProperty({
    example: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...',
    description: 'JWT refresh token used to obtain a new access token when the current one expires.',
  })
  refreshToken!: string;

  @ApiProperty({
    description: 'Authenticated user profile returned with the token pair.',
  })
  user!: {
    id: string;
    username: string;
    email: string;
    role: string;
  };
}
