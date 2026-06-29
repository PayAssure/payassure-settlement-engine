import { ApiProperty } from '@nestjs/swagger';
import { IsEmail, IsString, MinLength } from 'class-validator';

export class RegisterAdminDto {
  @ApiProperty({
    example: 'admin',
    description: 'Unique username for the new administrator account.',
  })
  @IsString()
  username!: string;

  @ApiProperty({
    example: 'admin@example.com',
    description: 'Unique email address for the new administrator account.',
  })
  @IsEmail()
  email!: string;

  @ApiProperty({
    example: '123456',
    description: 'Password for the new administrator account. Minimum length is 6 characters.',
  })
  @IsString()
  @MinLength(6)
  password!: string;
}
