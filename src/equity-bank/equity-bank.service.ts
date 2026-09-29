import { Injectable, Logger } from '@nestjs/common';
import { EquityBankAccountOperationsBase } from './operations/account-operations.base';

@Injectable()
export class EquityBankService extends EquityBankAccountOperationsBase {
  protected readonly logger = new Logger(EquityBankService.name);
}
