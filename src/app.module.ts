import { Module } from '@nestjs/common';
import { AuthModule } from './auth/auth.module';
import { OnbordingsModule } from './onbordings/onbordings.module';
import { SettlementModule } from './settlement/settlement.module';

@Module({
  imports: [SettlementModule, OnbordingsModule, AuthModule],
})
export class AppModule {}
