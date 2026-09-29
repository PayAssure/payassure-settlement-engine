import { retailerEscrowPayoutFlowService } from '../retailer-escrow-payout-flow.service';
import type { EscrowJsonRecord } from '../../retailer-escrow-transfer.helpers';
import { RetailerFundingOperationsBase } from './funding-operations.base';

export abstract class RetailerPayoutOperationsBase extends RetailerFundingOperationsBase {
  handleTransferCallback(transferId: string, body: EscrowJsonRecord): Promise<EscrowJsonRecord> {
    return retailerEscrowPayoutFlowService.handleTransferCallback(transferId, body);
  }

  handleTransferTimeout(transferId: string, body: EscrowJsonRecord): Promise<EscrowJsonRecord> {
    return retailerEscrowPayoutFlowService.handleTransferTimeout(transferId, body);
  }
}
