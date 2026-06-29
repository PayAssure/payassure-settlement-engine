import { PartialType } from '@nestjs/swagger';
import { CreateOnboardingDto } from './create-onboarding.dto';

export class UpdateOnboardingDto extends PartialType(CreateOnboardingDto) {}
