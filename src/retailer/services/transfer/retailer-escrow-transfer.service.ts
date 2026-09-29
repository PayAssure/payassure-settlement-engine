import { RetailerPayoutOperationsBase } from './facade-operations/payout-operations.base';

class RetailerEscrowTransferService extends RetailerPayoutOperationsBase {}

export const retailerEscrowTransferService = new RetailerEscrowTransferService();
