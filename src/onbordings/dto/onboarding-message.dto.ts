import { ApiProperty } from '@nestjs/swagger';

export class OnboardingMessageDto {
  @ApiProperty({ example: 1 })
  id: number = 0;

  @ApiProperty({ example: 'Welcome to the onboarding flow' })
  message: string = '';
}
