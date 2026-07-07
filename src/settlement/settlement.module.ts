import { Module } from '@nestjs/common';
import { SettlementController } from './settlement.controller';
import { SettlementService } from './settlement.service';
import { SettlementRepository } from './settlement.repository';
import { SupplierController } from './supplier.controller';

@Module({
  controllers: [SettlementController, SupplierController],
  providers: [SettlementService, SettlementRepository],
})
export class SettlementModule {}
