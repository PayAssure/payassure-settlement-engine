import { Controller } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { SettlementService } from './settlement.service';
import { SupplierProductsService } from './supplier-products.service';
import { SupplierProductsControllerBase } from './controllers/supplier-products.controller.base';

@ApiTags('supplier')
@Controller('supplier')
export class SupplierController extends SupplierProductsControllerBase {
  constructor(
    protected readonly settlementService: SettlementService,
    protected readonly supplierProductsService: SupplierProductsService,
  ) {
    super();
  }
}
