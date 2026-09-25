import { Module } from '@nestjs/common';
import { AuthModule } from './auth/auth.module';
import { HealthModule } from './health/health.module';
import { OnbordingsModule } from './onbordings/onbordings.module';
import { PaymentModule } from './payment/payment.module';
import { SettlementModule } from './settlement/settlement.module';
import { EscrowIntelligenceModule } from './escrow-intelligence/escrow-intelligence.module';
import { KcbModule } from './kcb/kcb.module';
import { CoopBankModule } from './coop-bank/coop-bank.module';
import { EquityBankModule } from './equity-bank/equity-bank.module';

@Module({
  imports: [SettlementModule, EscrowIntelligenceModule, OnbordingsModule, AuthModule, HealthModule, PaymentModule, KcbModule, CoopBankModule, EquityBankModule],
})
export class AppModule {}
