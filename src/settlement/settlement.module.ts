import { Module } from '@nestjs/common';
import { SettlementController } from './settlement.controller';
import { SettlementService } from './settlement.service';
import { SettlementRepository } from './settlement.repository';

@Module({
  controllers: [SettlementController],
  providers: [SettlementService, SettlementRepository],
})
export class SettlementModule {}
