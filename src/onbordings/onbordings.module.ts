import { Module } from '@nestjs/common';
import { OnbordingsController } from './onbordings.controller';
import { OnbordingsService } from './onbordings.service';
import { OnbordingsRepository } from './onbordings.repository';
import { EmailService } from './email.service';

@Module({
  controllers: [OnbordingsController],
  providers: [OnbordingsService, OnbordingsRepository, EmailService],
})
export class OnbordingsModule {}
