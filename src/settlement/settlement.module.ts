import { Module } from '@nestjs/common';
import { SettlementController } from './settlement.controller';
import { SettlementService } from './settlement.service';
import { SettlementRepository } from './settlement.repository';
import { SupplierController } from './supplier.controller';
import { B2BPayoutIdempotencyService } from './services/b2b-payout-idempotency.service';
import { B2BPayoutRetryService } from './services/b2b-payout-retry.service';
import { B2BPayoutRetryScheduler } from './services/b2b-payout-retry-scheduler.service';

@Module({
  controllers: [SettlementController, SupplierController],
  providers: [
    SettlementService,
    SettlementRepository,
    B2BPayoutIdempotencyService,
    B2BPayoutRetryService,
    B2BPayoutRetryScheduler,
  ],
  exports: [SettlementService, B2BPayoutIdempotencyService, B2BPayoutRetryService, B2BPayoutRetryScheduler],
})
export class SettlementModule {}
