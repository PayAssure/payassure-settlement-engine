import { Module } from '@nestjs/common';
import { KcbController } from './kcb.controller';
import { KcbService } from './kcb.service';

@Module({
  controllers: [KcbController],
  providers: [KcbService],
  exports: [KcbService],
})
export class KcbModule {}