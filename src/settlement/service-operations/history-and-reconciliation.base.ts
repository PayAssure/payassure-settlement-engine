import { BadRequestException, NotFoundException } from '@nestjs/common';
import { ReconcileSettlementDto } from '../dto/reconcile-settlement.dto';
import { SettlementHistoryQueryDto } from '../dto/settlement-history-query.dto';
import { ReconcileResponseDto } from '../dto/settlement-response.dto';
import { reconcileOperation } from '../operations/reconcile.operation';
import { SettlementTrackingBase } from './tracking.base';

export abstract class SettlementHistoryAndReconciliationBase extends SettlementTrackingBase {
  async getSettlementsByMerchantId(merchantId: string, filters: SettlementHistoryQueryDto) {
    const from = filters.from ? new Date(filters.from) : undefined;
    const to = filters.to ? new Date(filters.to) : undefined;
    if (from && to && from >= to) {
      throw new BadRequestException({ statusCode: 400, message: '`from` must be earlier than `to`', error: 'INVALID_DATE_RANGE' });
    }
    const integration = await this.repository.findIntegrationByMerchantId(merchantId);
    const settlements = await this.repository.findSettlementsByMerchantId(merchantId, integration?.id, from, to, filters.status);
    if (!integration && settlements.length === 0) {
      throw new NotFoundException({ statusCode: 404, message: 'Merchant integration not found and no supplier settlement matches the merchant ID', error: 'MERCHANT_NOT_FOUND' });
    }
    const supplierMerchantIds = [...new Set(
      settlements.flatMap((settlement: any) => (settlement.transactions ?? [])
        .map((transaction: any) => transaction.supplierMerchantId)
        .filter(Boolean)),
    )];
    const supplierNames = new Map<string, string>();
    await Promise.all(supplierMerchantIds.map(async (supplierMerchantId) => {
      const supplierIntegration = await this.repository.findIntegrationByMerchantId(supplierMerchantId);
      const supplierName = supplierIntegration?.participant?.businessName;
      if (supplierName) {
        supplierNames.set(supplierMerchantId, supplierName);
      }
    }));
    return {
      success: true,
      merchantId,
      from: filters.from ?? null,
      to: filters.to ?? null,
      count: settlements.length,
      data: settlements.map((settlement: any) => ({
        settlementId: settlement.id,
        reference: settlement.reference,
        merchantTransactionReference: settlement.merchantTransactionReference,
        status: settlement.status,
        amount: Number(settlement.amount),
        currency: settlement.currency,
        settlementMethod: settlement.settlementMethod,
        matchedPositions: [
          ...(integration?.id === settlement.integrationId ? ['RETAILER'] : []),
          ...((settlement.transactions ?? []).some((transaction: any) => transaction.supplierMerchantId === merchantId) ? ['SUPPLIER'] : []),
        ],
        description: settlement.description,
        createdAt: settlement.createdAt,
        processedAt: settlement.processedAt,
        completedAt: settlement.completedAt,
        reconciliationStatus: settlement.reconciliationStatus,
        bankReference: settlement.bankReference,
        transactions: (settlement.transactions ?? []).map((transaction: any) => ({
          transactionId: transaction.id,
          itemId: transaction.itemId,
          supplierName: transaction.supplierMerchantId ? supplierNames.get(transaction.supplierMerchantId) ?? null : null,
          type: transaction.type,
          amount: Number(transaction.amount),
          status: transaction.status,
          description: transaction.description,
          createdAt: transaction.createdAt,
          completedAt: transaction.completedAt,
        })),
      })),
    };
  }

  async reconcileSettlement(data: ReconcileSettlementDto): Promise<ReconcileResponseDto> {
    return reconcileOperation(this.repository, data);
  }
}
