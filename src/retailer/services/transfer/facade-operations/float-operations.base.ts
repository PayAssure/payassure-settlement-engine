import { retailerEscrowFloatService } from '../../retailer-escrow-float.service';
import type { EscrowJsonRecord } from '../../retailer-escrow-transfer.helpers';

export abstract class RetailerFloatOperationsBase {
  hasFloatConfig(merchantId: string): Promise<boolean> {
    return retailerEscrowFloatService.hasFloatConfig(merchantId);
  }

  getFloat(merchantId: string): Promise<EscrowJsonRecord> {
    return retailerEscrowFloatService.getFloat(merchantId);
  }

  setFloat(merchantId: string, dailyFloat: number, expectedRemainingBalance?: number): Promise<EscrowJsonRecord> {
    return retailerEscrowFloatService.setFloat(merchantId, dailyFloat, expectedRemainingBalance);
  }
}
