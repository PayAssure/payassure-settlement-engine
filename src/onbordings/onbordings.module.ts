import { Module } from '@nestjs/common';
import { OnbordingsController } from './onbordings.controller';
import { OnbordingsService } from './onbordings.service';
import { OnbordingsRepository } from './onbordings.repository';

@Module({
  controllers: [OnbordingsController],
  providers: [OnbordingsService, OnbordingsRepository],
})
export class OnbordingsModule {}
