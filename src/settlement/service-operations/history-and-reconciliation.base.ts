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
    if (!integration) {
      throw new NotFoundException({ statusCode: 404, message: 'Merchant integration not found', error: 'MERCHANT_NOT_FOUND' });
    }
    const settlements = await this.repository.findSettlementsByIntegrationId(integration.id, from, to);
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
        description: settlement.description,
        createdAt: settlement.createdAt,
        processedAt: settlement.processedAt,
        completedAt: settlement.completedAt,
        reconciliationStatus: settlement.reconciliationStatus,
        bankReference: settlement.bankReference,
        transactions: (settlement.transactions ?? []).map((transaction: any) => ({
          transactionId: transaction.id,
          itemId: transaction.itemId,
          supplierMerchantId: transaction.supplierMerchantId,
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
