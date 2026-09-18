import { Module } from '@nestjs/common';
import { CoopBankController } from './coop-bank.controller';
import { CoopBankService } from './coop-bank.service';

@Module({
  controllers: [CoopBankController],
  providers: [CoopBankService],
  exports: [CoopBankService],
})
export class CoopBankModule {}
