import { ApiProperty } from '@nestjs/swagger';

export class RegisterResponseDto {
  @ApiProperty({
    example: 'User account created successfully',
    description: 'Status message indicating successful registration',
  })
  message!: string;

  @ApiProperty({
    description: 'Registered user profile details',
  })
  user!: {
    id: string;
    username: string;
    email: string;
    role: string;
  };
}
