import type { EquityBankService } from '../equity-bank.service';

export abstract class EquityBankControllerContextBase {
  protected abstract readonly equityBankService: EquityBankService;
}
