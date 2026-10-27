import type { SettlementService } from '../settlement.service';
import type { SupplierProductsService } from '../supplier-products.service';
import type { SupplierDirectoryService } from '../supplier-directory.service';

export abstract class SupplierControllerContextBase {
  protected abstract readonly settlementService: SettlementService;
  protected abstract readonly supplierProductsService: SupplierProductsService;
  protected abstract readonly supplierDirectoryService: SupplierDirectoryService;
}
