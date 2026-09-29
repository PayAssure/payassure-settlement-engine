import { Controller } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { EquityBankService } from './equity-bank.service';
import { EquityBankRemittanceControllerBase } from './controllers/equity-remittance.controller.base';

@ApiTags('Equity Bank / Finserve')
@Controller('equity-bank')
export class EquityBankController extends EquityBankRemittanceControllerBase {
  constructor(protected readonly equityBankService: EquityBankService) {
    super();
  }
}
