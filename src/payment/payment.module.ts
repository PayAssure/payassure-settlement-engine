import { Module } from '@nestjs/common';
import { MpesaController } from './controllers/mpesa.controller';
import { PaymentCallbackController } from './controllers/payment-callback.controller';
import { SettlementModule } from '../settlement/settlement.module';

@Module({
  imports: [SettlementModule],
  controllers: [MpesaController, PaymentCallbackController],
})
export class PaymentModule {}
