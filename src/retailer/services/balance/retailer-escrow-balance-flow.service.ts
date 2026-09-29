import { BalanceFlowCallbacksBase } from './balance-flow-operations/balance-flow-callbacks.base';

class RetailerEscrowBalanceFlowService extends BalanceFlowCallbacksBase {}

export const retailerEscrowBalanceFlowService = new RetailerEscrowBalanceFlowService();
