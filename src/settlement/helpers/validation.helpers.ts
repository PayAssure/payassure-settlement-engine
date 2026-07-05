import { BadRequestException, Logger } from '@nestjs/common';
import { ParticipantStatus, ParticipantType } from '@prisma/client';
import { SettlementRepository } from '../settlement.repository';
import { InitiateSettlementDto } from '../dto/initiate-settlement.dto';
import { areAmountsEqual } from './reference.helpers';

export async function validateSettlementData(
  data: InitiateSettlementDto,
  repository: SettlementRepository,
  logger: Logger,
  supportedCurrencies: string[],
): Promise<void> {
  const errors: Array<{ field: string; message: string }> = [];

  if (data.totalAmount <= 0) {
    errors.push({ field: 'totalAmount', message: 'Total amount must be greater than 0' });
  }

  if (!data.currency) {
    errors.push({ field: 'currency', message: 'Currency is required' });
  } else if (!supportedCurrencies.includes(data.currency.toUpperCase())) {
    errors.push({ field: 'currency', message: 'Currency is not supported' });
  }

  if (!data.settlementMethod) {
    errors.push({ field: 'settlementMethod', message: 'Settlement method is required' });
  }

  if (!data.merchantTransactionReference) {
    errors.push({ field: 'merchantTransactionReference', message: 'Merchant transaction reference is required' });
  }

  if (!data.paymentMethod) {
    errors.push({ field: 'paymentMethod', message: 'Payment method is required' });
  } else {
    if (!data.paymentMethod.type) {
      errors.push({ field: 'paymentMethod.type', message: 'Payment method type is required' });
    } else {
      const methodType = data.paymentMethod.type.toUpperCase();
      if (!['MPESA', 'CASH'].includes(methodType)) {
        errors.push({ field: 'paymentMethod.type', message: 'Unsupported payment method' });
      }

      if (methodType === 'MPESA' && !data.paymentMethod.payerPhoneNumber) {
        errors.push({ field: 'paymentMethod.payerPhoneNumber', message: 'Payer phone number is required for MPESA' });
      }
    }
  }

  if (!data.transactionDate || Number.isNaN(Date.parse(data.transactionDate))) {
    errors.push({ field: 'transactionDate', message: 'Transaction date must be a valid ISO 8601 timestamp' });
  }

  if (!data.suppliers || data.suppliers.length === 0) {
    errors.push({ field: 'suppliers', message: 'At least one supplier allocation is required' });
  }

  logger.log(`Starting settlement payload validation: totalAmount=${data.totalAmount}, supplierGroups=${data.suppliers?.length ?? 0}`);
  let computedTotal = 0;

  for (const [supplierIndex, supplier] of (data.suppliers ?? []).entries()) {
    if (!supplier.supplierMerchantId) {
      errors.push({ field: `suppliers[${supplierIndex}].supplierMerchantId`, message: 'Supplier merchant ID is required for each supplier group' });
    }

    if (!supplier.items || supplier.items.length === 0) {
      errors.push({ field: `suppliers[${supplierIndex}].items`, message: 'Each supplier must include at least one item' });
      continue;
    }

    let supplierAmount = 0;
    let retailerAmount = 0;
    let platformFee = 0;

    for (const [itemIndex, item] of supplier.items.entries()) {
      if (!item.itemId) {
        errors.push({ field: `suppliers[${supplierIndex}].items[${itemIndex}].itemId`, message: 'Item ID is required for each supplier item' });
      }

      if (item.supplierAmount <= 0) {
        errors.push({ field: `suppliers[${supplierIndex}].items[${itemIndex}].supplierAmount`, message: 'Supplier amount must be greater than 0' });
      }

      if (item.retailerAmount && item.retailerAmount < 0) {
        errors.push({ field: `suppliers[${supplierIndex}].items[${itemIndex}].retailerAmount`, message: 'Retailer amount cannot be negative' });
      }

      if (item.platformFee && item.platformFee < 0) {
        errors.push({ field: `suppliers[${supplierIndex}].items[${itemIndex}].platformFee`, message: 'Platform fee cannot be negative' });
      }

      supplierAmount += item.supplierAmount;
      retailerAmount += item.retailerAmount ?? 0;
      platformFee += item.platformFee ?? 0;
    }

    if (supplier.supplierTotalAmount !== undefined && !areAmountsEqual(supplier.supplierTotalAmount, supplierAmount)) {
      errors.push({ field: `suppliers[${supplierIndex}].supplierTotalAmount`, message: `Supplier total amount ${supplier.supplierTotalAmount} does not match sum of item supplier amounts ${supplierAmount}` });
    }

    if (supplier.retailerTotalAmount !== undefined && !areAmountsEqual(supplier.retailerTotalAmount, retailerAmount)) {
      errors.push({ field: `suppliers[${supplierIndex}].retailerTotalAmount`, message: `Retailer total amount ${supplier.retailerTotalAmount} does not match sum of item retailer amounts ${retailerAmount}` });
    }

    if (supplier.platformFee !== undefined && !areAmountsEqual(supplier.platformFee, platformFee)) {
      errors.push({ field: `suppliers[${supplierIndex}].platformFee`, message: `Platform fee ${supplier.platformFee} does not match sum of item platform fees ${platformFee}` });
    }

    computedTotal += supplierAmount + retailerAmount + platformFee;

    const supplierIntegration = await repository.findIntegrationByMerchantId(supplier.supplierMerchantId);

    if (!supplierIntegration?.participant) {
      logger.warn(`Supplier lookup failed during validation: supplierMerchantId=${supplier.supplierMerchantId}`);
      errors.push({ field: `suppliers[${supplierIndex}].supplierMerchantId`, message: 'Supplier was not found in PayAssure' });
    } else {
      logger.log(`Supplier found during validation: supplierMerchantId=${supplier.supplierMerchantId}, status=${supplierIntegration.participant.status}`);
      const supplierStatus = supplierIntegration.participant.status as ParticipantStatus;
      const isActiveSupplier = supplierIntegration.participant.participantType === ParticipantType.SUPPLIER && ([ParticipantStatus.ACTIVE, ParticipantStatus.LIVE] as ParticipantStatus[]).includes(supplierStatus);

      if (!isActiveSupplier) {
        logger.warn(`Supplier not eligible during validation: supplierMerchantId=${supplier.supplierMerchantId}, status=${supplierStatus}`);
        errors.push({ field: `suppliers[${supplierIndex}].supplierMerchantId`, message: 'Supplier is not active or not eligible to receive settlements' });
      }

      const supplierPayment = supplierIntegration.participant.payment as any;
      if (!supplierPayment) {
        logger.warn(`Supplier has no configured payment destination: supplierMerchantId=${supplier.supplierMerchantId}`);
        errors.push({ field: `suppliers[${supplierIndex}].supplierMerchantId`, message: 'Supplier payout destination is not configured' });
      } else if (supplierPayment.status !== 'VERIFIED' && supplierPayment.isVerified !== true) {
        logger.warn(`Supplier payout destination not verified: supplierMerchantId=${supplier.supplierMerchantId}`);
        errors.push({ field: `suppliers[${supplierIndex}].supplierMerchantId`, message: 'Supplier payout destination must be verified before settlement' });
      }
    }
  }

  if (!areAmountsEqual(data.totalAmount, computedTotal)) {
    errors.push({ field: 'totalAmount', message: `Total amount ${data.totalAmount} does not match sum of supplier allocations ${computedTotal}` });
  }

  logger.log(`Settlement payload validation completed: computedTotal=${computedTotal}, errors=${errors.length}`);

  if (errors.length > 0) {
    throw new BadRequestException({
      statusCode: 400,
      message: 'Validation failed',
      error: 'VALIDATION_ERROR',
      errors,
    });
  }
}
