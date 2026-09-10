import { Module } from '@nestjs/common';
import { AuthModule } from './auth/auth.module';
import { HealthModule } from './health/health.module';
import { OnbordingsModule } from './onbordings/onbordings.module';
import { PaymentModule } from './payment/payment.module';
import { SettlementModule } from './settlement/settlement.module';

@Module({
  imports: [SettlementModule, OnbordingsModule, AuthModule, HealthModule, PaymentModule],
})
export class AppModule {}
