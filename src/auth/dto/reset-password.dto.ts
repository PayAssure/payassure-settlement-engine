import { ApiProperty } from '@nestjs/swagger';
import { IsString, Matches, MinLength } from 'class-validator';

export class ResetPasswordDto {
  @ApiProperty({ example: '482913', description: 'Six-digit password reset OTP received by email.' })
  @IsString()
  @Matches(/^\d{6}$/, { message: 'otp must be exactly 6 digits' })
  otp!: string;

  @ApiProperty({ example: 'new-strong-password', description: 'New account password. Minimum length is 6 characters.' })
  @IsString()
  @MinLength(6)
  newPassword!: string;
}