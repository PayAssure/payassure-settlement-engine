import { SettlementHistoryQueryDto } from '../dto/settlement-history-query.dto';
import { trackOperation } from '../operations/track.operation';
import { getTransactionOperation } from '../operations/get-transaction.operation';
import { SettlementInitiationBase } from './initiation.base';

export abstract class SettlementTrackingBase extends SettlementInitiationBase {
  async trackSettlement(settlementId: string, view: 'retailer' | 'supplier' | 'payassure' = 'retailer'): Promise<any> {
    return trackOperation(this.prisma, this.repository, settlementId, view);
  }

  async getTransaction(transactionId: string) {
    return getTransactionOperation(this.repository, transactionId);
  }
}
