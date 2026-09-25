import { Module } from '@nestjs/common';
import { EquityBankController } from './equity-bank.controller';
import { EquityBankService } from './equity-bank.service';

@Module({
  controllers: [EquityBankController],
  providers: [EquityBankService],
  exports: [EquityBankService],
})
export class EquityBankModule {}