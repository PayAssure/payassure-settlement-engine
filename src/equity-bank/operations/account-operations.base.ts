import { EquityBankTransferBase } from './transfer.base';
import {
  EquityBankAccountBalanceDto,
  EquityBankInternalTransferDto,
} from '../dto/equity-bank.dto';

export abstract class EquityBankAccountOperationsBase extends EquityBankTransferBase {
  async getAccountBalance(request: EquityBankAccountBalanceDto) {
    const config = this.getConfig();
    const authorization = await this.getAuthorization(config);
    const countryCode = request.countryCode.trim();
    const accountId = request.accountId.trim();
    const date = request.date?.trim() || new Date().toISOString().slice(0, 10);
    const signature = this.sign(`${accountId}${countryCode}${date}`, config);
    return this.request(config.accountBalanceUrl + `/${encodeURIComponent(countryCode)}/${encodeURIComponent(accountId)}`, 'GET', authorization, signature, undefined);
  }

  async internalBankTransfer(request: EquityBankInternalTransferDto) {
    const config = this.getConfig();
    const authorization = await this.getAuthorization(config);
    const signature = this.sign(`${request.source.accountNumber}${request.transfer.amount}${request.transfer.currencyCode}${request.transfer.reference}`, config);
    return this.request(config.internalTransferUrl, 'POST', authorization, signature, request);
  }
}
