import { BadRequestException } from '@nestjs/common';
import type { InitiateSettlementDto } from '../../../dto/initiate-settlement.dto';
import { validateSettlementData } from '../../../helpers/validation.helpers';

export async function validateAndFilterSuppliers(
  data: InitiateSettlementDto,
  repository: any,
  logger: any,
  supportedCurrencies: string[],
) {
  const validationResult = await validateSettlementData(data, repository, logger, supportedCurrencies);
  const invalidSupplierIndexes = new Set(validationResult.invalidSuppliers.map((supplier) => supplier.index));
  const invalidSuppliers = validationResult.invalidSuppliers.map((supplier) => ({
    supplierMerchantId: supplier.supplierMerchantId,
    errors: supplier.errors,
  }));
  if (invalidSupplierIndexes.size === 0) return invalidSuppliers;

  const eligibleSuppliers = data.suppliers.filter((_supplier, index) => !invalidSupplierIndexes.has(index));
  if (eligibleSuppliers.length === 0) {
    throw new BadRequestException({
      statusCode: 400,
      message: 'No eligible suppliers remain for settlement',
      error: 'NO_ELIGIBLE_SUPPLIERS',
      invalidSuppliers,
    });
  }

  data.suppliers = eligibleSuppliers;
  data.totalAmount = data.suppliers.reduce((total, supplier) => {
    const items = Array.isArray(supplier.items) ? supplier.items : [];
    const supplierAmount = items.length > 0
      ? items.reduce((sum, item) => sum + Number(item.supplierAmount ?? 0), 0)
      : Number(supplier.supplierTotalAmount ?? 0);
    return total + supplierAmount + Number(supplier.retailerTotalAmount ?? 0) + Number(supplier.platformFee ?? 0);
  }, 0);
  data.metadata = { ...(data.metadata ?? {}), excludedSuppliers: invalidSuppliers };
  logger.warn(`Excluded ${invalidSuppliers.length} invalid supplier allocation(s) from settlement`, { invalidSuppliers });
  return invalidSuppliers;
}