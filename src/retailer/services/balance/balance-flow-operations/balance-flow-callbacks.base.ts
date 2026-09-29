import { retailerEscrowBalanceQueryService } from '../retailer-escrow-balance-query.service';
import { retailerEscrowMpesaFundingService } from '../../transfer/retailer-escrow-mpesa-funding.service';
import type { EscrowJsonRecord } from '../../retailer-escrow-transfer.helpers';
import { BalanceStartBase } from './balance-start.base';

export abstract class BalanceFlowCallbacksBase extends BalanceStartBase {
  handleBalanceTimeout(transferId: string, body: EscrowJsonRecord): Promise<EscrowJsonRecord> {
    return retailerEscrowBalanceQueryService.handleTimeout(transferId, body);
  }

  handleMpesaFundingCallback(merchantTransactionReference: string, success: boolean): Promise<EscrowJsonRecord | null> {
    return retailerEscrowMpesaFundingService.handleCallback(merchantTransactionReference, success);
  }
}
