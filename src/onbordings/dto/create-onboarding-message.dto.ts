import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString } from 'class-validator';

export class CreateOnboardingMessageDto {
  @ApiProperty({ example: 'Welcome to the onboarding flow' })
  @IsString()
  @IsNotEmpty()
  message: string = '';
}
