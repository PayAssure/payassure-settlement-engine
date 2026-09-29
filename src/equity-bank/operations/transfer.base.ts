import { EquityBankAuthorizationBase } from './authorization.base';
import type { EquityBankConfig } from './types';
import { EquityBankInternalTransferDto, EquityBankPesalinkBankDto, EquityBankPesalinkMobileDto } from '../dto/equity-bank.dto';

export abstract class EquityBankTransferBase extends EquityBankAuthorizationBase {
  protected async pesalinkTransfer(request: EquityBankInternalTransferDto, url: string) {
    const config = this.getConfig();
    const authorization = await this.getAuthorization(config);
    const signature = this.sign(`${request.transfer.amount}${request.transfer.currencyCode}${request.transfer.reference}${request.destination.name}${request.source.accountNumber}`, config);
    return this.request(url, 'POST', authorization, signature, request);
  }

  async pesalinkBankTransfer(request: EquityBankPesalinkBankDto) {
    const config: EquityBankConfig = this.getConfig();
    return this.pesalinkTransfer(request, config.pesalinkBankUrl);
  }

  async pesalinkMobileTransfer(request: EquityBankPesalinkMobileDto) {
    const config: EquityBankConfig = this.getConfig();
    return this.pesalinkTransfer(request, config.pesalinkMobileUrl);
  }
}
