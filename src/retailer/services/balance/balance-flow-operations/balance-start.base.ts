import { retailerEscrowBalanceQueryService } from '../retailer-escrow-balance-query.service';
import { retailerEscrowBalanceCallbackService } from '../retailer-escrow-balance-callback.service';
import type { EscrowJsonRecord } from '../../retailer-escrow-transfer.helpers';

export abstract class BalanceStartBase {
  startForSettlement(request: {
    settlementId: string;
    merchantTransactionReference: string;
    retailerMerchantId: string;
    cashAmount: number;
    mpesaAmount: number;
    mpesaPayerPhone?: string;
  }): Promise<EscrowJsonRecord> {
    return retailerEscrowBalanceQueryService.startForSettlement(request);
  }

  handleBalanceCallback(transferId: string, body: EscrowJsonRecord): Promise<EscrowJsonRecord> {
    return retailerEscrowBalanceCallbackService.handleCallback(transferId, body);
  }
}
