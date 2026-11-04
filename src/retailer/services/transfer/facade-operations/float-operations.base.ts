import { retailerEscrowFloatService } from '../../retailer-escrow-float.service';
import type { EscrowJsonRecord } from '../../retailer-escrow-transfer.helpers';

export abstract class RetailerFloatOperationsBase {
  getAuthenticatedRetailerMerchantId(user: { email?: string } | undefined): Promise<string> {
    return retailerEscrowFloatService.getAuthenticatedRetailerMerchantId(user);
  }

  hasFloatConfig(merchantId: string): Promise<boolean> {
    return retailerEscrowFloatService.hasFloatConfig(merchantId);
  }

  getFloat(merchantId: string): Promise<EscrowJsonRecord> {
    return retailerEscrowFloatService.getFloat(merchantId);
  }

  getBalance(merchantId: string): Promise<EscrowJsonRecord> {
    return retailerEscrowFloatService.getBalance(merchantId);
  }

  setFloat(merchantId: string, dailyFloat: number): Promise<EscrowJsonRecord> {
    return retailerEscrowFloatService.setFloat(merchantId, dailyFloat);
  }
}
