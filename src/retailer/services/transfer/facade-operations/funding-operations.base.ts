import { retailerEscrowBalanceFlowService } from '../../balance/retailer-escrow-balance-flow.service';
import type { EscrowJsonRecord } from '../../retailer-escrow-transfer.helpers';
import { RetailerBalanceOperationsBase } from './balance-operations.base';

export abstract class RetailerFundingOperationsBase extends RetailerBalanceOperationsBase {
  handleMpesaFundingCallback(merchantTransactionReference: string, success: boolean): Promise<EscrowJsonRecord | null> {
    return retailerEscrowBalanceFlowService.handleMpesaFundingCallback(merchantTransactionReference, success);
  }
}
