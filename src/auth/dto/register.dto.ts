import { ApiProperty } from '@nestjs/swagger';
import { IsEmail, IsString, MinLength } from 'class-validator';

export class RegisterDto {
  @ApiProperty({
    example: 'wilfred',
    description: 'Unique username for the newly created user account.',
  })
  @IsString()
  username!: string;

  @ApiProperty({
    example: 'kimaniwilfred95@gmail.com',
    description: 'Required email address from your onboarding record. This is used as the lookup value to verify you are registered with PayAssure.',
    required: true,
  })
  @IsEmail()
  email!: string;

  @ApiProperty({
    example: '123456',
    description: 'Password for the new user account. Minimum length is 6 characters.',
  })
  @IsString()
  @MinLength(6)
  password!: string;
}
