import { BadRequestException } from '@nestjs/common';
import type { InitiateSettlementDto } from '../../../dto/initiate-settlement.dto';
import { validateSettlementData } from '../../../helpers/validation.helpers';

function updateResolvedSettlementMode(data: InitiateSettlementDto): void {
  const suppliers = data.suppliers ?? [];
  const hasDirectAllocations = suppliers.some((supplier) => supplier.supplierMerchantId == null || !String(supplier.supplierMerchantId).trim());
  const hasSupplierAllocations = suppliers.some((supplier) => !!supplier.supplierMerchantId && String(supplier.supplierMerchantId).trim().length > 0);
  const resolvedSettlementMode = hasDirectAllocations && hasSupplierAllocations
    ? 'MIXED'
    : hasDirectAllocations
      ? 'DIRECT'
      : 'SPLIT';
  data.metadata = { ...(data.metadata ?? {}), resolvedSettlementMode };
}

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
  if (invalidSupplierIndexes.size === 0) {
    updateResolvedSettlementMode(data);
    return invalidSuppliers;
  }

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
  updateResolvedSettlementMode(data);
  data.totalAmount = data.suppliers.reduce((total, supplier) => {
    const items = Array.isArray(supplier.items) ? supplier.items : [];
    const supplierAmount = supplier.supplierMerchantId == null
      ? 0
      : items.length > 0
      ? items.reduce((sum, item) => sum + Number(item.supplierAmount ?? 0), 0)
      : Number(supplier.supplierTotalAmount ?? 0);
    return total + supplierAmount + Number(supplier.retailerTotalAmount ?? 0) + Number(supplier.platformFee ?? 0);
  }, 0);
  data.metadata = { ...(data.metadata ?? {}), excludedSuppliers: invalidSuppliers };
  logger.warn(`Excluded ${invalidSuppliers.length} invalid supplier allocation(s) from settlement`, { invalidSuppliers });
  return invalidSuppliers;
}