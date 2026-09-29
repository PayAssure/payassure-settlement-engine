import { retailerEscrowBalanceFlowService } from '../../balance/retailer-escrow-balance-flow.service';
import type { EscrowJsonRecord } from '../../retailer-escrow-transfer.helpers';
import { RetailerFloatOperationsBase } from './float-operations.base';

export abstract class RetailerBalanceOperationsBase extends RetailerFloatOperationsBase {
  startForSettlement(request: {
    settlementId: string;
    merchantTransactionReference: string;
    retailerMerchantId: string;
    cashAmount: number;
    mpesaAmount: number;
    mpesaPayerPhone?: string;
  }): Promise<EscrowJsonRecord> {
    return retailerEscrowBalanceFlowService.startForSettlement(request);
  }

  handleBalanceCallback(transferId: string, body: EscrowJsonRecord): Promise<EscrowJsonRecord> {
    return retailerEscrowBalanceFlowService.handleBalanceCallback(transferId, body);
  }

  handleBalanceTimeout(transferId: string, body: EscrowJsonRecord): Promise<EscrowJsonRecord> {
    return retailerEscrowBalanceFlowService.handleBalanceTimeout(transferId, body);
  }
}
